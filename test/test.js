const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("NFT", function () {
  it("Should deploy correctly", async function () {
    const NFT = await ethers.getContractFactory("NFTContractName");
    const nft = await NFT.deploy();
    await nft.deployed();
  });
});
