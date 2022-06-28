require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const app = express();
const fs = require('fs').promises;
const path = require('path');
const { makeAsciiArt } = require('./utils/compile');
const exec = require('./utils/exec');
const chains = require('./utils/chains');

async function compile(collectionName, collectionSymbol, asciiArt) {
  const currentContract = await fs.readFile(path.join(__dirname, 'contracts', 'NFT.sol'), 'utf8');
  const contractOutFile = `${collectionName}.sol`;
  const compilationOutFile = `${collectionName}.json`;
  const contractOutPath = path.join(__dirname, 'contracts', contractOutFile);
  await fs.writeFile(
    contractOutPath,
    currentContract
      .replace('NFTContractName', collectionName)
      .replace('__collectionName', collectionName)
      .replace('__collectionSymbol', collectionSymbol)
      .replace('// ASCII ART', makeAsciiArt(asciiArt))
  );

  await exec('rm -rf artifacts/ cache/', {
    cwd: __dirname
  });
  const compilation = await exec('npx hardhat compile', {
    cwd: __dirname,
    shell: process.env.BASH_PATH
  });
  console.log(compilation);
  return JSON.parse(await fs.readFile(
    path.join(__dirname, `artifacts/contracts/${contractOutFile}/${compilationOutFile}`),
    'utf8'
  ));
}

async function verify(network, address, contractName) {
  const verification = await exec(`npx hardhat --network ${network} verify --contract contracts/${contractName}.sol:${contractName} ${address}`, {
    cwd: __dirname,
    shell: process.env.BASH_PATH
  });
  console.log(verification);
  const url = verification.stdout.split('\n').find(l => /^https:\/\//.test(l));
  return {url};
}

function main() {
  app.use(cors());
  app.use(bodyParser.json({limit: '50mb'}));

  app.post('/compile', async (req, res) => {
    try {
      const compilationResult = await compile(req.body.name, req.body.symbol, req.body.asciiArt);
      res.json(compilationResult);
    } catch (e) {
      console.log(e);
      res.status(500).json({error: e.message});
    }
  });

  app.post('/verify', async (req, res) => {
    try {
      const response = await verify(chains[req.body.chainId], req.body.address, req.body.name);
      res.json(response);
    } catch (e) {
      console.log(e);
      res.status(500).json({error: e.message});
    }
  })

  app.listen(8081, () => console.log('Listening 8081'));
}

main();
