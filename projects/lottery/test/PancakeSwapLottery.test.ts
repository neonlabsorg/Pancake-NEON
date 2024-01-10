import { parseEther } from "ethers/lib/utils";
import { artifacts, contract, ethers } from "hardhat";
import { BN, expectEvent, time } from "@openzeppelin/test-helpers";
import { promises as fs } from "fs";

const MockERC20 = artifacts.require("./utils/MockERC20.sol");
const MockRandomNumberGenerator = artifacts.require("./utils/MockRandomNumberGenerator.sol");
const PancakeSwapLottery = artifacts.require("./PancakeSwapLottery.sol");

const PRICE_BNB = 400;

type ReportItem = { [key: string]: string | number };
let report = {
  name: "Pancake lottery",
  actions: [] as ReportItem[],
};

function gasToBNB(gas: number, gwei: number = 5) {
  const num = gas * gwei * 10 ** -9;
  return num.toFixed(4);
}

function gasToUSD(gas: number, gwei: number = 5, priceBNB: number = PRICE_BNB) {
  const num = gas * priceBNB * gwei * 10 ** -9;
  return num.toFixed(2);
}

contract("Lottery V2", ([alice, bob, carol, david, erin, operator, treasury, injector]) => {
  // VARIABLES
  const _totalInitSupply = parseEther("10000");

  let _lengthLottery = new BN("14400"); // 4h
  let _priceTicketInCake = parseEther("0.5");
  let _discountDivisor = "2000";

  let _rewardsBreakdown = ["200", "300", "500", "1500", "2500", "5000"];
  let _treasuryFee = "2000";

  // Contracts
  let lottery, mockCake, randomNumberGenerator;

  // Generic variables
  let result: any;
  let endTime;

  let gasPrice;

  before(async () => {
    // Deploy MockCake
    mockCake = await MockERC20.new("Mock CAKE", "CAKE", _totalInitSupply);

    // Deploy MockRandomNumberGenerator
    randomNumberGenerator = await MockRandomNumberGenerator.new({ from: alice });

    // Deploy PancakeSwapLottery
    lottery = await PancakeSwapLottery.new(mockCake.address, randomNumberGenerator.address, { from: alice });

    await randomNumberGenerator.setLotteryAddress(lottery.address, { from: alice });

    gasPrice = await ethers.provider.getGasPrice();
  });

  after(async () => {
    await fs.writeFile("report_lottery.json", JSON.stringify(report));
  });

  describe("LOTTERY #1 - CUSTOM RANDOMNESS", async () => {
    it("Admin sets up treasury/operator address", async () => {
      result = await lottery.setOperatorAndTreasuryAndInjectorAddresses(operator, treasury, injector, { from: alice });
      expectEvent(result, "NewOperatorAndTreasuryAndInjectorAddresses", {
        operator: operator,
        treasury: treasury,
        injector: injector,
      });
    });

    it("Users mint and approve CAKE to be used in the lottery", async () => {
      for (let thisUser of [alice, bob, carol, david, erin, injector]) {
        await mockCake.mintTokens(parseEther("100000"), { from: thisUser });
        await mockCake.approve(lottery.address, parseEther("100000"), {
          from: thisUser,
        });
      }
    });

    it("Operator starts lottery", async () => {
      endTime = new BN(await time.latest()).add(_lengthLottery);

      result = await lottery.startLottery(
        endTime,
        _priceTicketInCake,
        _discountDivisor,
        _rewardsBreakdown,
        _treasuryFee,
        { from: operator }
      );

      expectEvent(result, "LotteryOpen", {
        lotteryId: "1",
        endTime: endTime.toString(),
        priceTicketInCake: _priceTicketInCake.toString(),
        firstTicketId: "0",
        injectedAmount: "0",
      });

      console.info(
        `        --> Cost to start the lottery: ${gasToBNB(result.receipt.gasUsed)} (USD: ${gasToUSD(
          result.receipt.gasUsed
        )})`
      );

      report["actions"].push({
        name: "Cost to start the lottery",
        usedGas: result.receipt["gasUsed"].toString(),
        gasPrice: gasPrice.toString(),
        tx: result.receipt["transactionHash"],
      });
    });

    it("Carol buys 1 ticket", async () => {
      const _ticketsBought = ["1111111"];
      // Carol buys 1/1/1/1/1/1
      result = await lottery.buyTickets("1", _ticketsBought, { from: carol });
      expectEvent(result, "TicketsPurchase", { buyer: carol, lotteryId: "1", numberTickets: "1" });

      console.info(
        `        --> Cost to buy a stand-alone ticket: ${gasToBNB(result.receipt.gasUsed)} (USD: ${gasToUSD(
          result.receipt.gasUsed
        )})`
      );

      report["actions"].push({
        name: "Cost to buy a stand-alone ticket",
        usedGas: result.receipt["gasUsed"].toString(),
        gasPrice: gasPrice.toString(),
        tx: result.receipt["transactionHash"],
      });

      expectEvent.inTransaction(result.receipt.transactionHash, mockCake, "Transfer", {
        from: carol,
        to: lottery.address,
        value: parseEther("0.5").toString(),
      });
    });

    it("Owner does 10k CAKE injection", async () => {
      result = await lottery.injectFunds("1", parseEther("10000"), { from: alice });
      expectEvent(result, "LotteryInjection", { lotteryId: "1", injectedAmount: parseEther("10000").toString() });

      console.info(
        `        --> Cost to do injection: ${gasToBNB(result.receipt.gasUsed)} (USD: ${gasToUSD(
          result.receipt.gasUsed
        )})`
      );

      report["actions"].push({
        name: "Cost to do injection",
        usedGas: result.receipt["gasUsed"].toString(),
        gasPrice: gasPrice.toString(),
        tx: result.receipt["transactionHash"],
      });

      expectEvent.inTransaction(result.receipt.transactionHash, mockCake, "Transfer", {
        from: alice,
        to: lottery.address,
        value: parseEther("10000").toString(),
      });
    });
  });
});
