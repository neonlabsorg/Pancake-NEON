import { parseEther } from "ethers/lib/utils";
import { artifacts, contract } from "hardhat";
import { assert } from "chai";
import { BN, constants, expectEvent, expectRevert } from "@openzeppelin/test-helpers";

const ERC721NFTMarketV1 = artifacts.require("./ERC721NFTMarketV1.sol");
const PancakeBunniesWhitelistChecker = artifacts.require("./PancakeBunniesWhitelistChecker.sol");

const MockERC20 = artifacts.require("./test/MockERC20.sol");
const MockNFT = artifacts.require("./test/MockNFT.sol");
const WBNB = artifacts.require("./test/WBNB.sol");
const PancakeBunnies = artifacts.require(".test/PancakeBunnies.sol");

contract(
  "ERC721 NFT Market V1",
  ([owner, admin, treasury, buyer1, buyer2, buyer3, seller1, seller2, seller3, creator1]) => {
    // VARIABLES
    let minimumAskPrice = parseEther("0.001");
    let maximumAskPrice = parseEther("100");

    // Contracts
    let collectibleMarket,
      mockERC20,
      mockNFT1,
      mockNFT2,
      mockNFT3,
      mockNFT4,
      pancakeBunnies,
      pancakeBunniesChecker,
      wrappedBNB;

    before(async () => {
      // Deploy WBNB
      wrappedBNB = await WBNB.new({ from: owner });

      // Deploy CollectibleMarketV1
      collectibleMarket = await ERC721NFTMarketV1.new(
        admin,
        treasury,
        wrappedBNB.address,
        minimumAskPrice,
        maximumAskPrice,
        { from: owner }
      );

      // Deploy PancakeBunnies (modified implementation in Solidity 0.8)
      pancakeBunnies = await PancakeBunnies.new({ from: owner });

      // Deploy pancakeBunniesChecker
      pancakeBunniesChecker = await PancakeBunniesWhitelistChecker.new(pancakeBunnies.address, { from: owner });

      // Deploy MockNFT 1
      mockNFT1 = await MockNFT.new("Mock NFT 1", "MN1", { from: owner });

      // Deploy MockNFT 2
      mockNFT2 = await MockNFT.new("Mock NFT 2", "MN2", { from: owner });

      // Deploy MockNFT 3
      mockNFT3 = await MockNFT.new("Mock NFT 3", "MN3", { from: owner });

      // Deploy MockNFT 4
      mockNFT4 = await MockNFT.new("Mock NFT 4", "MN4", { from: owner });

      // Deploy MockERC20
      mockERC20 = await MockERC20.new("Mock ERC20", "ERC", parseEther("1000"), { from: owner });

      // Mint 3 NFTs and approve
      let i = 0;

      for (let user of [seller1, seller2, seller3]) {
        i++;
        await mockNFT1.setApprovalForAll(collectibleMarket.address, true, { from: user });
        await mockNFT2.setApprovalForAll(collectibleMarket.address, true, { from: user });
        await mockNFT3.setApprovalForAll(collectibleMarket.address, true, { from: user });

        await mockNFT1.mint("ipfs://token" + i + " .json", { from: user });
        await mockNFT1.mint("ipfs://token" + i + " .json", { from: user });
        await mockNFT2.mint("ipfs://token" + i + " .json", { from: user });
        await mockNFT2.mint("ipfs://token" + i + " .json", { from: user });
        await mockNFT3.mint("ipfs://token" + i + " .json", { from: user });
        await mockNFT3.mint("ipfs://token" + i + " .json", { from: user });
      }

      for (let user of [buyer1, buyer2, buyer3, seller1, seller2, seller3]) {
        await wrappedBNB.deposit({ value: parseEther("10").toString(), from: user });
        await wrappedBNB.approve(collectibleMarket.address, constants.MAX_UINT256, { from: user });
      }
    });

    describe("COLLECTIBLE MARKET #3 - TOKEN RESTRICTIONS/PANCAKEBUNNIES", async () => {
      it("Add collection with restrictions", async () => {
        const result = await collectibleMarket.addCollection(
          pancakeBunnies.address,
          constants.ZERO_ADDRESS,
          pancakeBunniesChecker.address,
          "100", // 1%
          "0",
          { from: admin }
        );

        expectEvent(result, "CollectionNew", {
          collection: pancakeBunnies.address,
          creator: constants.ZERO_ADDRESS,
          whitelistChecker: pancakeBunniesChecker.address,
          tradingFee: "100",
          creatorFee: "0",
        });

        assert.equal(await pancakeBunniesChecker.canList("1"), true);
        assert.equal(await pancakeBunniesChecker.canList("2"), true);
        assert.equal(await pancakeBunniesChecker.canList("3"), true);
        assert.equal(await pancakeBunniesChecker.canList("4"), true);
        assert.equal(await pancakeBunniesChecker.canList("211"), true);

        const tokenListingStatuses = await collectibleMarket.canTokensBeListed(pancakeBunnies.address, [
          "0",
          "1",
          "2",
          "3",
          "4",
          "5",
        ]);

        const boolArray = Array.from({ length: 6 }, (i) => (i = true));

        assert.sameOrderedMembers(tokenListingStatuses, boolArray);
      });

      it("Owner mint bunnyId 1-5 for seller1 and owner adds restrictions for bunnyId 3/4", async () => {
        let i = 0;

        while (i < 5) {
          await pancakeBunnies.mint(seller1, "ipfs://" + i.toString(), i, { from: owner });
          i++;
        }

        const result = await pancakeBunniesChecker.addRestrictionForBunnies([new BN("3"), new BN("4")]);
        expectEvent(result, "NewRestriction");

        assert.equal(await pancakeBunniesChecker.isBunnyIdRestricted("3"), true);
        assert.equal(await pancakeBunniesChecker.isBunnyIdRestricted("4"), true);

        // For convenience, tokenId = 0 --> bunnyId = 0, tokenId = 1 --> bunnyId = 1
        assert.equal(await pancakeBunniesChecker.canList("3"), false);
        assert.equal(await pancakeBunniesChecker.canList("4"), false);

        const tokenListingStatuses = await collectibleMarket.canTokensBeListed(pancakeBunnies.address, ["3", "4"]);
        const boolArray = Array.from({ length: 2 }, (i) => (i = false));
        assert.sameOrderedMembers(tokenListingStatuses, boolArray);
      });

      it("Seller 1 can sell tokenIds 0-2 (bunnyIds 0-2)", async () => {
        await pancakeBunnies.setApprovalForAll(collectibleMarket.address, true, { from: seller1 });

        let result = await collectibleMarket.createAskOrder(pancakeBunnies.address, "0", parseEther("1"), {
          from: seller1,
        });

        expectEvent(result, "AskNew", {
          collection: pancakeBunnies.address,
          seller: seller1,
          tokenId: "0",
          askPrice: parseEther("1").toString(),
        });

        result = await collectibleMarket.createAskOrder(pancakeBunnies.address, "1", parseEther("1"), {
          from: seller1,
        });

        expectEvent(result, "AskNew", {
          collection: pancakeBunnies.address,
          seller: seller1,
          tokenId: "1",
          askPrice: parseEther("1").toString(),
        });

        result = await collectibleMarket.createAskOrder(pancakeBunnies.address, "2", parseEther("1"), {
          from: seller1,
        });

        expectEvent(result, "AskNew", {
          collection: pancakeBunnies.address,
          seller: seller1,
          tokenId: "2",
          askPrice: parseEther("1").toString(),
        });
      });

      it("Seller 1 cannot sell tokenIds 3-4 (bunnyIds 3-4)", async () => {
        await expectRevert(
          collectibleMarket.createAskOrder(pancakeBunnies.address, "3", parseEther("1"), {
            from: seller1,
          }),
          "Order: tokenId not eligible"
        );

        await expectRevert(
          collectibleMarket.createAskOrder(pancakeBunnies.address, "4", parseEther("1"), {
            from: seller1,
          }),
          "Order: tokenId not eligible"
        );
      });

      it("Owner removes restrictions for bunnyId=4", async () => {
        let result = await pancakeBunniesChecker.removeRestrictionForBunnies([new BN("4")]);
        expectEvent(result, "RemoveRestriction");

        assert.equal(await pancakeBunniesChecker.isBunnyIdRestricted("3"), true);
        assert.equal(await pancakeBunniesChecker.isBunnyIdRestricted("4"), false);
        assert.equal(await pancakeBunniesChecker.canList("3"), false);
        assert.equal(await pancakeBunniesChecker.canList("4"), true);

        const tokenListingStatuses = await collectibleMarket.canTokensBeListed(pancakeBunnies.address, ["3", "4"]);
        assert.equal(tokenListingStatuses[0], false);
        assert.equal(tokenListingStatuses[1], true);

        result = await collectibleMarket.createAskOrder(pancakeBunnies.address, "4", parseEther("1"), {
          from: seller1,
        });

        expectEvent(result, "AskNew", {
          collection: pancakeBunnies.address,
          seller: seller1,
          tokenId: "4",
          askPrice: parseEther("1").toString(),
        });
      });

      it("Revert statements work as expected", async () => {
        await expectRevert(
          pancakeBunniesChecker.removeRestrictionForBunnies([new BN("3"), new BN("4")], { from: owner }),
          "Operations: Not restricted"
        );

        await expectRevert(
          pancakeBunniesChecker.addRestrictionForBunnies([new BN("3"), new BN("4")], { from: owner }),
          "Operations: Already restricted"
        );
      });
    });
  }
);
