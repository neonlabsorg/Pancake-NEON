import type { HardhatUserConfig, NetworkUserConfig } from "hardhat/types";
import "@nomiclabs/hardhat-ethers";
import "@nomiclabs/hardhat-web3";
import "@nomiclabs/hardhat-truffle5";
import "hardhat-abi-exporter";
import "hardhat-contract-sizer";
import "solidity-coverage";
import "dotenv/config";

const bscTestnet: NetworkUserConfig = {
  url: "https://data-seed-prebsc-1-s1.binance.org:8545/",
  chainId: 97,
  accounts: [process.env.KEY_TESTNET!],
};

const bscMainnet: NetworkUserConfig = {
  url: "https://bsc-dataseed.binance.org/",
  chainId: 56,
  accounts: [process.env.KEY_MAINNET!],
};

const neonlabs: NetworkUserConfig = {
  url: process.env.NEON_PROXY_URL,
  accounts: process.env.NEON_ACCOUNTS.split(","),
  chainId: parseInt(process.env.NEON_CHAIN_ID) || 111,
  allowUnlimitedContractSize: false,
  timeout: 100000000,
};

const config: HardhatUserConfig = {
  defaultNetwork: "neonlabs",
  networks: {
    hardhat: {},
    neonlabs: neonlabs,
  },
  mocha: {
    timeout: 100000000,
  },
  solidity: {
    version: "0.8.4",
    settings: {
      optimizer: {
        enabled: true,
        runs: 99999,
      },
    },
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  abiExporter: {
    path: "./data/abi",
    clear: true,
    flat: false,
  },
};

export default config;
