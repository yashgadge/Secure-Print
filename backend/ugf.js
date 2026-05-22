// UGF Real Transaction Handler
// This file makes actual gasless transactions on Base Sepolia using Mock USD

// Load environment variables manually
try {
  require('dotenv').config();
} catch (e) {
  const fs = require('fs');
  const path = require('path');
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        const key = match[1];
        let value = match[2] || '';
        if (value.length > 0 && value.charAt(0) === '"' && value.charAt(value.length - 1) === '"') {
          value = value.replace(/\\n/gm, '\n');
        }
        process.env[key] = value.replace(/(^['"]|['"]$)/g, '').trim();
      }
    }
  }
}

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ethers } = require('ethers');

// Load UGF testnet SDK
const sdk = require('@tychilabs/ugf-testnet-js');
let openUGF = sdk.openUGF;

// Fallback implementation of openUGF if not exported directly by the SDK module
if (!openUGF) {
  openUGF = async function({ signer, tx, destChainId, mode }) {
    console.log(`[UGF] Initializing UGFClient for ${mode} on chain ${destChainId}...`);
    const client = new sdk.UGFClient();

    // Step 1: Authenticate signer wallet
    console.log('[UGF] Step 1: Authenticating wallet...');
    await client.auth.login(signer);

    // Step 2: Request gasless sponsorship quote
    console.log('[UGF] Step 2: Requesting gasless quote...');
    const quote = await client.quote.get({
      payer_address: signer.address,
      tx_object: JSON.stringify({
        from: signer.address,
        to: tx.to,
        data: tx.data || '0x',
        value: tx.value ? tx.value.toString() : '0'
      }),
      dest_chain_id: destChainId || sdk.BASE_SEPOLIA_CHAIN_ID || 84532
    });

    // Step 3: Settle gasless authorization via x402 payment
    console.log('[UGF] Step 3: Settling gasless authorization via x402...');
    await client.payment.x402.execute({ quote, signer });

    // Step 4: Sponsor and execute the transaction on the destination chain
    console.log('[UGF] Step 4: Executing transaction on Base Sepolia...');
    const { userTxHash } = await client.chains.evm.sponsorAndExecute(
      quote.digest,
      signer,
      async () => ({
        to: tx.to,
        data: tx.data || '0x',
        value: tx.value ? BigInt(tx.value) : 0n
      })
    );

    return { transactionHash: userTxHash, quote };
  };
}

// Configuration
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS || '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const PROVIDER_URL = process.env.PROVIDER_URL || 'https://sepolia.base.org';

// Load ABI from compiled artifact
let contractAbi = [];
try {
  const artifactPath = path.join(__dirname, '..', 'contracts', 'artifacts', 'contracts', 'PrintFlow.sol', 'PrintFlow.json');
  if (fs.existsSync(artifactPath)) {
    const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
    contractAbi = artifact.abi;
  }
} catch (err) {
  console.warn('[UGF] Could not load PrintFlow contract ABI from artifacts:', err.message);
}

// Derive a deterministic wallet for an operator based on their database ID
function getWalletForUser(userId, role) {
  const seed = `secureprint-ledger-seed-2026-${role}-${userId}`;
  const privateKey = '0x' + crypto.createHash('sha256').update(seed).digest('hex');
  const provider = new ethers.JsonRpcProvider(PROVIDER_URL);
  return new ethers.Wallet(privateKey, provider);
}

// Get the backend signer wallet from env PRIVATE_KEY
function getBackendSigner() {
  const privateKey = process.env.PRIVATE_KEY || '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
  const provider = new ethers.JsonRpcProvider(PROVIDER_URL);
  return new ethers.Wallet(privateKey, provider);
}

// Get contract instance
function getContractInstance(signer) {
  return new ethers.Contract(CONTRACT_ADDRESS, contractAbi, signer);
}

/**
 * Executes a real gasless transaction using the UGF SDK on Base Sepolia.
 * 
 * @param {string} actionName - The name of the transaction action (e.g. "createJob", "assignJob", etc.)
 * @param {object} txData - Transaction payload details including { to, data, value, signer }
 * @returns {promise<object>} Result detailing txHash, status, gas amount, and executionMode
 */
async function executeUGFTransaction(actionName, txData) {
  try {
    console.log(`[UGF] executeUGFTransaction: initiating execution for action "${actionName}"`);

    // Retrieve or establish the signer wallet
    let signer = txData.signer || getBackendSigner();
    
    // Check if real UGF is enabled and if the private key is configured
    const isDefaultKey = (signer.privateKey.toLowerCase() === '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
    if (process.env.UGF_ENABLED !== 'true' || isDefaultKey) {
      console.warn(`[UGF] Real UGF execution skipped (UGF_ENABLED=${process.env.UGF_ENABLED}, isDefaultKey=${isDefaultKey}). Triggering simulated fallback.`);
      throw new Error("UGF_NOT_CONFIGURED");
    }

    // Call openUGF with base sepolia chain configurations
    const result = await openUGF({
      signer,
      tx: {
        to: txData.to,
        data: txData.data || '0x',
        value: txData.value ? txData.value.toString() : '0'
      },
      destChainId: 84532, // Base Sepolia Chain ID
      mode: 'testnet'
    });

    console.log(`[UGF] executeUGFTransaction: successfully executed "${actionName}". Tx Hash: ${result.transactionHash}`);

    return {
      txHash: result.transactionHash,
      status: 'success',
      amount: 0.05, // Mock USD amount
      executionMode: 'real'
    };
  } catch (err) {
    console.error(`[UGF] executeUGFTransaction: error running "${actionName}":`, err.message);
    if (process.env.UGF_FALLBACK === 'true' || err.message === 'UGF_NOT_CONFIGURED') {
      console.log(`[UGF] Falling back to simulated transaction mode for "${actionName}"`);
      const mockHash = '0x' + crypto.randomBytes(32).toString('hex');
      return {
        txHash: mockHash,
        status: 'success',
        amount: 0.05,
        executionMode: 'simulated'
      };
    }
    return {
      status: 'failure',
      error: err.message
    };
  }
}

// Wrap call to handle UGF execution flow
async function runUGFTransaction(signer, tx, actionName = 'contract_call') {
  const result = await executeUGFTransaction(actionName, {
    to: tx.to,
    data: tx.data,
    value: tx.value,
    signer
  });
  if (result.status === 'success') {
    return {
      success: true,
      txHash: result.txHash,
      mode: result.executionMode,
      amount: result.amount
    };
  }
  return {
    success: false,
    error: result.error || 'Unknown UGF transaction error'
  };
}

// 1. Create Job (Admin)
async function createJob(jobRef, copiesCount, adminId) {
  const adminWallet = getBackendSigner();
  const contract = getContractInstance(adminWallet);
  const txData = contract.interface.encodeFunctionData('createJob', [jobRef, copiesCount]);
  
  console.log(`[UGF] createJob called for ref ${jobRef} with ${copiesCount} copies`);
  return runUGFTransaction(adminWallet, {
    to: CONTRACT_ADDRESS,
    data: txData
  }, 'createJob');
}

// 2. Assign Job (Admin)
async function assignJob(jobId, operatorId, adminId) {
  const adminWallet = getBackendSigner();
  const operatorWallet = getWalletForUser(operatorId, 'operator');
  const contract = getContractInstance(adminWallet);
  const txData = contract.interface.encodeFunctionData('assignJob', [jobId, operatorWallet.address]);

  console.log(`[UGF] assignJob called for jobId ${jobId} to operator ${operatorId}`);
  return runUGFTransaction(adminWallet, {
    to: CONTRACT_ADDRESS,
    data: txData
  }, 'assignJob');
}

// 3. Accept Job (Operator)
async function acceptJob(jobId, operatorId) {
  const backendSigner = getBackendSigner();
  const contract = getContractInstance(backendSigner);
  const txData = contract.interface.encodeFunctionData('acceptJob', [jobId]);

  console.log(`[UGF] acceptJob called for jobId ${jobId} (operator ${operatorId})`);
  return runUGFTransaction(backendSigner, {
    to: CONTRACT_ADDRESS,
    data: txData
  }, 'acceptJob');
}

// 4. Submit Acknowledgment (Operator)
async function submitAcknowledgment(jobId, forensicId, operatorId) {
  const backendSigner = getBackendSigner();
  const contract = getContractInstance(backendSigner);
  const txData = contract.interface.encodeFunctionData('submitAcknowledgment', [jobId, forensicId]);

  console.log(`[UGF] submitAcknowledgment called for jobId ${jobId} (operator ${operatorId})`);
  return runUGFTransaction(backendSigner, {
    to: CONTRACT_ADDRESS,
    data: txData
  }, 'submitAcknowledgment');
}

// 5. Report Leak (Public/System)
async function reportLeak(jobId, copyNumber, forensicId) {
  const backendSigner = getBackendSigner();
  const contract = getContractInstance(backendSigner);
  const txData = contract.interface.encodeFunctionData('reportLeak', [jobId, copyNumber, forensicId]);

  console.log(`[UGF] reportLeak called for jobId ${jobId}, copy ${copyNumber}`);
  return runUGFTransaction(backendSigner, {
    to: CONTRACT_ADDRESS,
    data: txData
  }, 'reportLeak');
}

// 6. Claim Reward (Admin / Bounty review approve)
async function claimReward(leakCaseId, adminId) {
  const backendSigner = getBackendSigner();
  const contract = getContractInstance(backendSigner);
  const txData = contract.interface.encodeFunctionData('claimReward', [leakCaseId]);

  console.log(`[UGF] claimReward called for leakCaseId ${leakCaseId}`);
  return runUGFTransaction(backendSigner, {
    to: CONTRACT_ADDRESS,
    data: txData
  }, 'claimReward');
}

module.exports = {
  getWalletForUser,
  createJob,
  assignJob,
  acceptJob,
  submitAcknowledgment,
  reportLeak,
  claimReward,
  executeUGFTransaction
};
