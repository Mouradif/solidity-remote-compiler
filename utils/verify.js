const { Interface } = require("@ethersproject/abi");
const { request } = require('undici');

const COMPILERS_LIST_URL = "https://solc-bin.ethereum.org/bin/list.json";

class EtherscanResponse {
  constructor(response) {
    this.status = parseInt(response.status, 10);
    this.message = response.result;
  }

  isPending() {
    return this.message === "Pending in queue";
  }

  isVerificationFailure() {
    return this.message === "Fail - Unable to verify";
  }

  isVerificationSuccess() {
    return this.message === "Pass - Verified";
  }

  isBytecodeMissingInNetworkError() {
    return this.message.startsWith("Unable to locate ContractCode at");
  }

  isOk() {
    return this.status === 1;
  }
}

async function getVersions() {
  // It would be better to query an etherscan API to get this list but there's no such API yet.
  const response = await request(COMPILERS_LIST_URL, { method: "GET" });

  return response.body.json();
}

async function getLongVersion(shortVersion) {
  const versions = await getVersions();
  const fullVersion = versions.releases[shortVersion];

  if (fullVersion === undefined || fullVersion === "") {
    throw new Error("Given solc version doesn't exist");
  }

  return fullVersion.replace(/(soljson-)(.*)(.js)/, "$2");
}
async function encodeArguments(
  abi,
  sourceName,
  contractName,
  constructorArguments
) {
  const contractInterface = new Interface(abi);
  return contractInterface
    .encodeDeploy(constructorArguments)
    .replace("0x", "");
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));


function buildContractUrl(
  browserURL,
  contractAddress
) {
  const normalizedBrowserURL = browserURL.trim().replace(/\/$/, "");

  return `${normalizedBrowserURL}/address/${contractAddress}#code`;
}

async function getVerificationStatus(url, req) {
  console.log('getVerificationStatus');
  const parameters = new URLSearchParams({ ...req });
  const urlWithQuery = new URL(url);
  urlWithQuery.search = parameters.toString();

  let response;
  try {
    response = await request(urlWithQuery, { method: "GET" });

    if (!(response.statusCode >= 200 && response.statusCode <= 299)) {
      // This could be always interpreted as JSON if there were any such guarantee in the Etherscan API.
      const responseText = await response.body.text();
      const message = `The HTTP server response is not ok. Status code: ${response.statusCode} Response text: ${responseText}`;

      throw new Error(message);
    }
  } catch (error) {
    throw new Error(`Failure during etherscan status polling. The verification may still succeed but
should be checked manually.
Endpoint URL: ${urlWithQuery.toString()}
Reason: ${error.message}`);
  }

  const etherscanResponse = new EtherscanResponse(await response.body.json());

  if (etherscanResponse.isPending()) {
    await delay(1500);

    return getVerificationStatus(url, req);
  }

  if (etherscanResponse.isVerificationFailure()) {
    return etherscanResponse;
  }

  if (!etherscanResponse.isOk()) {
    throw new Error(`The Etherscan API responded with a failure status.
The verification may still succeed but should be checked manually.
Reason: ${etherscanResponse.message}`);
  }

  return etherscanResponse;
}

function toVerifyRequest({
  apikey,
  contractaddress,
  sourceCode,
  sourceName,
  contractName,
  compilerVersion,
  constructorArguments
}) {
  return {
    apikey,
    module: "contract",
    action: "verifysourcecode",
    contractaddress,
    sourceCode: sourceCode,
    codeformat: "solidity-standard-json-input",
    contractname: `${sourceName}:${contractName}`,
    compilerversion: compilerVersion
  };
}

function toCheckStatusRequest({
  apikey,
  guid
}) {
  return {
    apikey,
    module: "contract",
    action: "checkverifystatus",
    guid,
  };
}

async function verifyContract(
  url,
  req
) {
  console.log('verifyContract');
  const parameters = new URLSearchParams({ ...req });
  const method = "POST";
  const requestDetails = {
    method,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: parameters.toString(),
  };

  console.log({url, requestDetails});

  const response = await request(url, requestDetails);

  if (!(response.statusCode >= 200 && response.statusCode <= 299)) {
    // This could be always interpreted as JSON if there were any such guarantee in the Etherscan API.
    const responseText = await response.body.text();
    throw new Error(`Failed to send contract verification request.
Endpoint URL: ${url}
The HTTP server response is not ok. Status code: ${response.statusCode} Response text:

${responseText}
`);
  }

  try {
    const etherscanResponse = new EtherscanResponse(await response.body.json());

    if (etherscanResponse.isBytecodeMissingInNetworkError()) {
      throw new Error(`Failed to send contract verification request.
Endpoint URL: ${url}
Reason: The Etherscan API responded that the address ${req.contractaddress} does not have bytecode.
This can happen if the contract was recently deployed and this fact hasn't propagated to the backend yet.
Try waiting for a minute before verifying your contract. If you are invoking this from a script,
try to wait for five confirmations of your contract deployment transaction before running the verification subtask.`);
    }

    if (!etherscanResponse.isOk()) {
      throw new Error(etherscanResponse.message);
    }

    return etherscanResponse;
  } catch (e) {
    console.log(e.message);
  }
}

async function attemptVerification(
  etherscanAPIEndpoints,
  contractInformation,
  contractaddress,
  etherscanAPIKey,
  compilerInput,
  solcFullVersion,
  deployArgumentsEncoded
) {
  // Ensure the linking information is present in the compiler input;
  const request = toVerifyRequest({
    apikey: etherscanAPIKey,
    contractaddress,
    sourceCode: JSON.stringify(compilerInput),
    sourceName: contractInformation.sourceName,
    contractName: contractInformation.contractName,
    compilerVersion: solcFullVersion,
    constructorArguments: deployArgumentsEncoded,
  });
  const response = await verifyContract(etherscanAPIEndpoints.apiURL, request);

  console.log(
    `Successfully submitted source code for contract
${contractInformation.sourceName}:${contractInformation.contractName} at ${contractAddress}
for verification on the block explorer. Waiting for verification result...
`
  );

  const pollRequest = toCheckStatusRequest({
    apiKey: etherscanAPIKey,
    guid: response.message,
  });

  // Compilation is bound to take some time so there's no sense in requesting status immediately.
  await delay(700);
  const verificationStatus = await getVerificationStatus(
    etherscanAPIEndpoints.apiURL,
    pollRequest
  );

  if (
    verificationStatus.isVerificationFailure() ||
    verificationStatus.isVerificationSuccess()
  ) {
    return verificationStatus;
  }

  // Reaching this point shouldn't be possible unless the API is behaving in a new way.
  throw new Error(`The API responded with an unexpected message.
Contract verification may have succeeded and should be checked manually.
Message: ${verificationStatus.message}`);
}



const verify = async (
  { chainId, address, constructorArguments, contractInformation }
) => {
  const urls = [null, {
    apiURL: 'https://api.etherscan.io/',
    browserURL: 'https://etherscan.io/',
  },null,{
    apiURL: 'https://api-ropsten.etherscan.io/',
    browserURL: 'https://ropsten.etherscan.io/',
  },{
    apiURL: 'https://api-rinkeby.etherscan.io/',
    browserURL: 'https://rinkeby.etherscan.io/',
  }];

  const etherscanAPIKey = process.env.ETHERSCAN_API_KEY;

  let deployArgumentsEncoded;
  if (constructorArguments.length > 0) {
    deployArgumentsEncoded = await encodeArguments(
      contractInformation.contract.abi,
      contractInformation.sourceName,
      contractInformation.contractName,
      constructorArguments
    );
  }

  const solcFullVersion = await getLongVersion(contractInformation.solcVersion);

  // Fallback verification
  const verificationStatus = await attemptVerification(
    urls[chainId],
    contractInformation,
    address,
    etherscanAPIKey,
    contractInformation.compilerInput,
    solcFullVersion,
    deployArgumentsEncoded
  );

  if (verificationStatus.isVerificationSuccess()) {
    const contractURL = buildContractUrl(
      urls[chainId].browserURL,
      address
    );

    return {
      contractName: contractInformation.contractName,
      url: contractURL
    };
  }

  let errorMessage = `The contract verification failed.
Reason: ${verificationStatus.message}`;
  if (contractInformation.undetectableLibraries.length > 0) {
    const undetectableLibraryNames = contractInformation.undetectableLibraries
      .map(({ sourceName, libName }) => `${sourceName}:${libName}`)
      .map((x) => `  * ${x}`)
      .join("\n");
    errorMessage += `
This contract makes use of libraries whose addresses are undetectable by the plugin.
Keep in mind that this verification failure may be due to passing in the wrong
address for one of these libraries:
${undetectableLibraryNames}`;
  }
  throw new Error(errorMessage);
};

module.exports = verify;
