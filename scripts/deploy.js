const hre = require("hardhat");

async function main() {
  const contractName = process.env.CONTRACT_NAME;
  const NFT = await hre.ethers.getContractFactory(contractName);
  const nft = await NFT.deploy();

  await nft.deployed();

  console.log(`${contractName} deployed to: ${nft.address}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
