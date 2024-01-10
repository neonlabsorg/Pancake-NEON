import { assert } from "chai";
import { artifacts, contract } from "hardhat";
import { BN, constants, expectEvent, expectRevert, time } from "@openzeppelin/test-helpers";
import { parseEther } from "ethers/lib/utils";

const NFTSale = artifacts.require("NFTSale");
const MockVRFCoordinator = artifacts.require("./test/MockVRFCoordinator");

const PancakeSquad = artifacts.require("PancakeSquad");
const MockERC20 = artifacts.require("./test/MockERC20");
const MockERC721 = artifacts.require("./test/MockERC721");
const PancakeProfile = artifacts.require("./test/MockPancakeProfile");

contract("Pancake Squad", ([owner, operator, alice, bob, carol, david, erin]) => {
  let mockCake, fakeCake, mockPancakeBunnies, nftSale, pancakeProfile, pancakeSquad;
  let maxSupply;
  let maxReserveSupply;
  let mockURI;
  let mockVRF;
  let mockLink;

  let startTimestamp;
  let maxPerAddress;
  let maxPerTransaction;
  let pricePerTicket;

  before(async () => {
    let amount = parseEther("10000");

    // Token setup
    mockCake = await MockERC20.new("PancakeSwap", "Cake", amount, { from: owner });
    fakeCake = await MockERC20.new("FakeSwap", "Fake", amount, { from: owner });
    mockLink = await MockERC20.new("MockLink", "LINK", amount, { from: owner });

    // Pancake Bunnies / Profile setup
    mockPancakeBunnies = await MockERC721.new("Pancake Bunnies", "PB", { from: owner });
    pancakeProfile = await PancakeProfile.new(mockCake.address, parseEther("2"), parseEther("1"), parseEther("2"), {
      from: owner,
    });

    await pancakeProfile.addTeam("1st Team", "Be a Chef!", { from: owner });
    await pancakeProfile.addNftAddress(mockPancakeBunnies.address, { from: owner });

    maxSupply = "100";
    maxReserveSupply = "10";
    pricePerTicket = parseEther("1").toString(); // 1 CAKE

    // Deploy PancakeSquad
    pancakeSquad = await PancakeSquad.new("Pancake Squad", "PSQ", maxSupply, {
      from: owner,
    });

    // Deploy MockVRF
    mockVRF = await MockVRFCoordinator.new({ from: owner });

    // Deploy NFTSale contract
    nftSale = await NFTSale.new(
      pancakeSquad.address,
      maxReserveSupply,
      pricePerTicket,
      mockCake.address,
      pancakeProfile.address,
      operator,
      mockVRF.address,
      mockLink.address,
      { from: owner }
    );

    // Handle profile creation, mint Cake, and all approvals for 4 users
    let i = 0;

    for (let user of [alice, bob, carol, david]) {
      await mockPancakeBunnies.mint({ from: user });
      await mockPancakeBunnies.setApprovalForAll(pancakeProfile.address, true, { from: user });
      await mockCake.mintTokens(amount, { from: user });
      await mockCake.approve(pancakeProfile.address, constants.MAX_UINT256, { from: user });
      await mockCake.approve(nftSale.address, constants.MAX_UINT256, { from: user });
      await pancakeProfile.createProfile("1", mockPancakeBunnies.address, i.toString(), { from: user });
      i++;
    }

    // Change sale contract from the VRF
    await mockVRF.changeNFTSaleContract(nftSale.address, { from: owner });

    // Transfer owner of the PancakeSquad
    await pancakeSquad.transferOwnership(nftSale.address, { from: owner });

    mockURI = "ipfs://qwertyuiop/";

    // Set the Base URI
    await nftSale.setBaseURI(mockURI, { from: operator });

    // CAKE Token
    await mockCake.approve(nftSale.address, constants.MAX_UINT256, { from: alice });
    await mockCake.approve(nftSale.address, constants.MAX_UINT256, { from: bob });
  });

  describe("#1 - Normal behavior", async () => {
    it("Operator cannot draw randomness without keyhash", async () => {
      await expectRevert(nftSale.drawRandomness({ from: operator }), "Operations: Must have valid key hash");

      const mockKeyHash = "0xcaf3c3727e033261d383b315559476f48034c13b18f8cafed4d871abe5049186";
      const mockFee = "100000000000000000";

      // Set up proper parameters for the NFT sale
      await nftSale.setFeeAndKeyHash(mockFee, mockKeyHash, { from: operator });
    });

    it("Operator cannot draw randomness without LINK tokens", async () => {
      await expectRevert(nftSale.drawRandomness({ from: operator }), "Operations: Not enough LINK tokens");

      // Transfer LINK tokens to the NFTSale for the sale
      await mockLink.transfer(nftSale.address, parseEther("100"), { from: owner });
    });

    it("Randomness test with mock VRF", async () => {
      const result = await nftSale.drawRandomness({ from: operator });

      const latestRequestId = await nftSale.latestRequestId();
      expectEvent(result, "RandomnessRequest", { latestRequestId: latestRequestId, currentStatus: "0" });

      await mockVRF.rawFulfillRandomness(latestRequestId, "123456");

      // 123456 % 100 = 56
      assert.equal(String(await nftSale.randomOffsetNumber()), "56");
    });

    it("Operator handles whitelists 4 users", async () => {
      const whitelistedUsers = [alice, bob, carol, david];
      let result = await nftSale.whitelistAddresses(whitelistedUsers, ["1", "2", "2", "2"], { from: operator });
      expectEvent(result, "AddressesWhitelisted");
    });

    it("Operator updates to the first phase (premint by admin)", async () => {
      assert.equal(await nftSale.canClaimForGen0(alice), false);
      const result = await nftSale.updateSaleStatus("1", { from: operator });
      expectEvent(result, "SaleStatusUpdate", { newStatus: "1" });

      // Whitelisted users cannot claim, it is admin time
      assert.equal(await nftSale.canClaimForGen0(alice), false);
    });

    it("Operator claims reserve tickets", async () => {
      let result = await nftSale.getReserveTickets("8", { from: operator });
      expectEvent(result, "TicketsDistributed", { user: operator, numberTickets: "8" });

      await expectRevert(
        nftSale.getReserveTickets("3", { from: operator }),
        "Operations: Must be inferior to maxReserveSupply"
      );

      result = await nftSale.getReserveTickets("2", { from: operator });
      expectEvent(result, "TicketsDistributed", { user: operator, numberTickets: "2" });

      await expectRevert(
        nftSale.getReserveTickets("1", { from: operator }),
        "Operations: Must be inferior to maxReserveSupply"
      );

      await expectRevert(nftSale.getReserveTickets("0", { from: operator }), "Tickets: Cannot buy zero");

      assert.equal(String(await nftSale.totalTicketsDistributed()), maxReserveSupply);
    });

    it("Operator cannot be changed after a ticket was received", async () => {
      await expectRevert(nftSale.setOperatorAddress(erin, { from: owner }), "Operations: Cannot change operator");
    });

    it("Operator can change price per ticket", async () => {
      const result = await nftSale.setTicketPrice(parseEther("0.5").toString(), { from: operator });
      expectEvent(result, "NewPricePerTicket", { pricePerTicket: parseEther("0.5").toString() });

      // Revert the change to the original price
      await nftSale.setTicketPrice(pricePerTicket, { from: operator });
    });

    it("Operator updates to the second phase (presale for gen0)", async () => {
      assert.equal(await nftSale.canClaimForGen0(alice), false);
      const result = await nftSale.updateSaleStatus("2", { from: operator });
      expectEvent(result, "SaleStatusUpdate", { newStatus: "2" });

      assert.equal(await nftSale.canClaimForGen0(alice), true);
    });

    it("Operator can change price per ticket after the presale starts", async () => {
      await expectRevert(nftSale.setTicketPrice(pricePerTicket, { from: operator }), "Status: Must be pending");
    });

    it("Operator cannot buy reserve tickets if not done in premint phase", async () => {
      await expectRevert(nftSale.getReserveTickets("8", { from: operator }), "Status: Must be in premint");
    });

    it("Cannot mint outside of the claim phase", async () => {
      await expectRevert(nftSale.mint(["0", "1"], { from: operator }), "Status: Must be in claim");
    });

    it("Cannot whitelist if lengths differ", async () => {
      await expectRevert(
        nftSale.whitelistAddresses([david], ["1", "2"], { from: operator }),
        "Operations: Lengths must match"
      );
      await expectRevert(
        nftSale.whitelistAddresses([david, erin], ["1"], { from: operator }),
        "Operations: Lengths must match"
      );
    });

    it("Operator handles unwhitelists one of them", async () => {
      assert.equal(await nftSale.canClaimForGen0(david), true);

      const result = await nftSale.unwhitelistAddresses([david], { from: operator });
      expectEvent(result, "AddressesUnwhitelisted", { users: [david] });

      assert.equal(await nftSale.canClaimForGen0(david), false);
    });

    it("2 users get ticket(s) for gen0", async () => {
      assert.equal(await nftSale.canClaimForGen0(alice), true);
      let result = await nftSale.buyTicketsInPreSaleForGen0("1", { from: alice });
      expectEvent(result, "TicketsDistributed", { user: alice, numberTickets: "1" });
      assert.equal(await nftSale.canClaimForGen0(alice), false);
      assert.equal(String(await nftSale.viewNumberTicketsOfUser(alice)), "1");

      await expectRevert(
        nftSale.buyTicketsInPreSaleForGen0("1", { from: alice }),
        "Tickets: Number of tickets too high"
      );
      await expectRevert(nftSale.buyTicketsInPreSaleForGen0("0", { from: bob }), "Tickets: Cannot buy zero");

      assert.equal(await nftSale.canClaimForGen0(bob), true);
      await expectRevert(nftSale.buyTicketsInPreSaleForGen0("3", { from: bob }), "Tickets: Number of tickets too high");

      result = await nftSale.buyTicketsInPreSaleForGen0("2", { from: bob });
      expectEvent(result, "TicketsDistributed", { user: bob, numberTickets: "2" });

      assert.equal(await nftSale.canClaimForGen0(bob), false);
      assert.equal(String(await nftSale.viewNumberTicketsOfUser(bob)), "2");

      await expectRevert(nftSale.buyTicketsInPreSaleForGen0("2", { from: bob }), "Tickets: Number of tickets too high");

      assert.equal(String(await nftSale.totalTicketsDistributed()), "13");
    });

    it("Operator cannot change the sale to the third phase if sale parameters are not set", async () => {
      await expectRevert(
        nftSale.updateSaleStatus("3", { from: operator }),
        "Operations: startTimestamp is too close or has passed"
      );
    });

    it("Operator cannot change the sale to the third phase if startTimestamp has passed", async () => {
      startTimestamp = "1"; // 1970
      maxPerAddress = "40";
      maxPerTransaction = "10";

      await expectRevert(
        nftSale.setSaleProperties("1", maxPerAddress, maxPerTransaction, {
          from: operator,
        }),
        "Operations: Cannot set startTimestamp before current time"
      );
    });

    it("Operator cannot change the sale to the third phase if startTimestamp is too close", async () => {
      startTimestamp = (await time.latest()).add(new BN("10"));

      const result = await nftSale.setSaleProperties(startTimestamp.toString(), maxPerAddress, maxPerTransaction, {
        from: operator,
      });

      expectEvent(result, "NewSaleProperties", {
        startTimestamp: startTimestamp.toString(),
        maxPerAddress: maxPerAddress,
        maxPerTransaction: maxPerTransaction,
      });

      await expectRevert(
        nftSale.updateSaleStatus("3", { from: operator }),
        "Operations: startTimestamp is too close or has passed"
      );
    });

    it("Operator cannot change the sale to the third phase if startTimestamp is too far", async () => {
      startTimestamp = (await time.latest()).add(new BN("90000"));

      const result = await nftSale.setSaleProperties(startTimestamp.toString(), maxPerAddress, maxPerTransaction, {
        from: operator,
      });

      expectEvent(result, "NewSaleProperties", {
        startTimestamp: startTimestamp.toString(),
        maxPerAddress: maxPerAddress,
        maxPerTransaction: maxPerTransaction,
      });

      await expectRevert(nftSale.updateSaleStatus("3", { from: operator }), "Operations: startTimestamp is too far");
    });

    it("Operator can change the status to normal sale if parameters are properly set", async () => {
      startTimestamp = (await time.latest()).add(new BN("3650"));
      const result = await nftSale.setSaleProperties(startTimestamp.toString(), maxPerAddress, maxPerTransaction, {
        from: operator,
      });

      expectEvent(result, "NewSaleProperties", {
        startTimestamp: startTimestamp.toString(),
        maxPerAddress: maxPerAddress,
        maxPerTransaction: maxPerTransaction,
      });
    });

    it("Cannot buy tickets before the sale period", async () => {
      await expectRevert(nftSale.buyTickets("1", { from: alice }), "Status: Must be in sale");
    });

    it("Operator updates to the third phase (normal sale)", async () => {
      assert.equal(await nftSale.canClaimForGen0(carol), true);
      const result = await nftSale.updateSaleStatus("3", { from: operator });
      expectEvent(result, "SaleStatusUpdate", { newStatus: "3" });

      // Whitelisted users cannot claim anymore
      assert.equal(await nftSale.canClaimForGen0(carol), false);
      await expectRevert(nftSale.buyTicketsInPreSaleForGen0("1", { from: carol }), "Status: Must be in presale");
    });

    it("Cannot whitelist/unwhitelist once the general sale phase starts", async () => {
      await expectRevert(
        nftSale.whitelistAddresses([david], ["1"], { from: operator }),
        "Status: Must not in sale or after"
      );
      await expectRevert(
        nftSale.unwhitelistAddresses([carol], { from: operator }),
        "Status: Must not in sale or after"
      );
    });

    it("User cannot buy tickets before startTimestamp", async () => {
      await expectRevert(nftSale.buyTickets("10", { from: alice }), "Tickets: Too early to buy");
      await time.increaseTo(startTimestamp.add(new BN("1")));
    });

    it("User cannot buy tickets without a profile", async () => {
      await expectRevert(nftSale.buyTickets("1", { from: erin }), "Tickets: User is not eligible");
    });

    it("Cannot start sale before all tickets are distributed", async () => {
      await expectRevert(
        nftSale.updateSaleStatus("4", { from: operator }),
        "Operations: Total tickets distributed must equal maxSupply"
      );
    });

    it("Owner cannot claim outside of claim phase", async () => {
      await expectRevert(nftSale.claim({ from: owner }), "Status: Must be in claim");
    });

    it("Cannot mint outside of the claim phase", async () => {
      await expectRevert(nftSale.mint(["10"], { from: alice }), "Status: Must be in claim");
    });

    it("Cannot lock outside of the claim phase", async () => {
      await expectRevert(nftSale.lock({ from: owner }), "Status: Must be in claim");
    });

    it("Cannot change ownership outside of the claim phase", async () => {
      await expectRevert(nftSale.changeOwnershipPancakeSquad(owner, { from: owner }), "Status: Must be in claim");
    });

    it("Cannot mint before the VRF answers", async () => {
      await expectRevert(nftSale.mint(["10"], { from: alice }), "Status: Must be in claim");
    });
  });

  describe("#3 - Owner/Operator functions", async () => {
    let recoveryAmount = parseEther("100");

    it("Owner can recover token from NFTSale", async () => {
      // Fake CAKE Token
      await fakeCake.mintTokens(parseEther("1000"), { from: david });
      await fakeCake.transfer(nftSale.address, parseEther("100"), { from: david });

      const result = await nftSale.recoverToken(fakeCake.address, { from: owner });

      expectEvent(result, "TokenRecovery", {
        token: fakeCake.address,
        amount: recoveryAmount.toString(),
      });

      expectEvent.inTransaction(result.receipt.transactionHash, fakeCake, "Transfer", {
        from: nftSale.address,
        to: owner,
        value: recoveryAmount.toString(),
      });
    });

    it("Owner cannot recover token if balance is zero from NFTSale", async () => {
      await expectRevert(
        nftSale.recoverToken(fakeCake.address, { from: owner }),
        "Operations: Cannot recover zero balance"
      );
    });

    it("Owner cannot recover CAKE tokens from NFTSale", async () => {
      await expectRevert(nftSale.recoverToken(mockCake.address, { from: owner }), "Operations: Cannot recover CAKE");
    });

    it("Owner functions can only be called by the owner for NFTSale", async () => {
      await expectRevert(
        pancakeSquad.recoverToken(fakeCake.address, { from: alice }),
        "Ownable: caller is not the owner"
      );

      await expectRevert(pancakeSquad.lock({ from: alice }), "Ownable: caller is not the owner");

      await expectRevert(pancakeSquad.mint(alice, "100", { from: alice }), "Ownable: caller is not the owner");

      await expectRevert(pancakeSquad.setBaseURI("ipfs://alice", { from: alice }), "Ownable: caller is not the owner");
    });

    it("Owner functions can only be called by the owner for NFTSale", async () => {
      for (let user of [alice, operator]) {
        await expectRevert(
          nftSale.changeOwnershipPancakeSquad(alice, { from: user }),
          "Ownable: caller is not the owner"
        );

        await expectRevert(
          nftSale.changeOwnershipPancakeSquad(alice, { from: user }),
          "Ownable: caller is not the owner"
        );

        await expectRevert(nftSale.claim({ from: user }), "Ownable: caller is not the owner");
        await expectRevert(nftSale.lock({ from: user }), "Ownable: caller is not the owner");

        await expectRevert(nftSale.setOperatorAddress(user, { from: user }), "Ownable: caller is not the owner");

        await expectRevert(nftSale.recoverToken(fakeCake.address, { from: user }), "Ownable: caller is not the owner");
      }
    });

    it("Operator functions can only be called by the operator for NFTSale", async () => {
      for (let user of [alice, owner]) {
        await expectRevert(nftSale.getReserveTickets("3", { from: user }), "Operations: Not operator");

        await expectRevert(nftSale.drawRandomness({ from: user }), "Operations: Not operator");
        await expectRevert(nftSale.setBaseURI("ipfs://alice", { from: user }), "Operations: Not operator");
        await expectRevert(
          nftSale.setFeeAndKeyHash("1", "0xcaf3c3727e033261d383b315559476f48034c13b18f8cafed4d871abe5049186", {
            from: user,
          }),
          "Operations: Not operator"
        );

        await expectRevert(
          nftSale.setSaleProperties(startTimestamp.toString(), maxPerAddress, maxPerTransaction, {
            from: user,
          }),
          "Operations: Not operator"
        );

        await expectRevert(nftSale.updateSaleStatus("1", { from: user }), "Operations: Not operator");
        await expectRevert(nftSale.whitelistAddresses([david], ["1"], { from: user }), "Operations: Not operator");
        await expectRevert(nftSale.unwhitelistAddresses([david], { from: user }), "Operations: Not operator");
        await expectRevert(nftSale.setTicketPrice("1", { from: user }), "Operations: Not operator");
      }
    });
  });
});
