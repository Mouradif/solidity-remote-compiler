const path = require('path');
const fs = require('fs');
const solc = require('solc');

const entryFileName = 'NFT.sol';

const entryFilePath = path.join(__dirname, '..', 'contracts', entryFileName);
const globalSources = {};
const mappings = {};

function resolveDependencies(fileName, filePath) {
  if (mappings[path.basename(fileName)] !== undefined) return;
  const file = fs.readFileSync(filePath, 'utf8');
  globalSources[fileName] = { content: file };
  mappings[path.basename(fileName)] = file;
  const importLines = file.split('\n').map(l => l.trim()).filter(l => /^import /.test(l));
  for (const importLine of importLines) {
    const pathMatch = importLine.match(/"(.+)";$/);
    if (!pathMatch) throw new Error(`Could not parse import instruction : '${importLine}'`);
    const relativePath = pathMatch[1];
    if (mappings[path.basename(relativePath)] !== undefined) continue;
    let fullPath;
    if (relativePath.startsWith('.')) {
      fullPath = path.join(path.dirname(filePath), relativePath);
    } else {
      fullPath = path.join(__dirname, '..', 'node_modules', relativePath);
    }
    resolveDependencies(relativePath, fullPath);
  }
}

function makeAsciiArt(ascii) {
  return ascii?.split('\n').map(l => `// ${l}`).join('\n') ?? '';
}

function compileWithOptions(options = {}) {
  const {
    collectionName,
    collectionSymbol,
    asciiArt
  } = options;

  const sources = JSON.parse(JSON.stringify(globalSources));

  sources[entryFileName].content = sources[entryFileName].content
    .replace('__collectionName', collectionName ?? 'TheCollection')
    .replace('__collectionSymbol', collectionSymbol ?? 'SYM')
    .replace('NFTContractName', collectionName ?? 'TheContract')
    .replace('// ASCII ART', makeAsciiArt(asciiArt))

  const output = solc.compile(
    JSON.stringify({
      language: 'Solidity',
      sources,
      settings: {
        outputSelection: {
          "*": {
            "*": [ "abi", "evm.bytecode" ]
          }
        }
      }
    }),
    {
      import: (p) => ({
        contents: mappings[path.basename(p)]
      })
    }
  );

  return {input: sources, output: JSON.parse(output)};
}

resolveDependencies(entryFileName, entryFilePath);

module.exports = {
  compileWithOptions,
  makeAsciiArt
};
