const ugf = require('./ugf');

async function runE2ETests() {
  console.log('==================================================');
  console.log('🚀 SECUREPRINT LEDGER - UGF E2E FLOW TEST RUNNER');
  console.log('==================================================\n');

  const adminId = 1;
  const operatorId = 2;
  const jobRef = `TEST-JOB-${Date.now().toString().slice(-4)}`;
  const forensicId = `TEST-FORENSIC-${Date.now().toString().slice(-4)}`;
  const jobId = Math.floor(Math.random() * 1000) + 10;
  const leakCaseId = Math.floor(Math.random() * 500) + 5;

  // Flow 1: Create Job (Admin)
  console.log('🔹 FLOW 1: Creating Job (Admin)...');
  const res1 = await ugf.createJob(jobRef, 3, adminId);
  console.log(`   Result: ${res1.success ? '✅ SUCCESS' : '❌ FAILED'}`);
  console.log(`   Tx Hash: ${res1.txHash}`);
  console.log(`   Gas Sponsor Amount: ${res1.amount} TYI_MOCK_USD`);
  console.log(`   Execution Mode: ${res1.mode}\n`);
  if (!res1.success) throw new Error('Create Job flow failed');

  // Flow 2: Assign Job (Admin)
  console.log('🔹 FLOW 2: Assigning Job to Operator (Admin)...');
  const res2 = await ugf.assignJob(jobId, operatorId, adminId);
  console.log(`   Result: ${res2.success ? '✅ SUCCESS' : '❌ FAILED'}`);
  console.log(`   Tx Hash: ${res2.txHash}`);
  console.log(`   Gas Sponsor Amount: ${res2.amount} TYI_MOCK_USD`);
  console.log(`   Execution Mode: ${res2.mode}\n`);
  if (!res2.success) throw new Error('Assign Job flow failed');

  // Flow 3: Accept Job (Operator)
  console.log('🔹 FLOW 3: Accepting Job (Operator)...');
  const res3 = await ugf.acceptJob(jobId, operatorId);
  console.log(`   Result: ${res3.success ? '✅ SUCCESS' : '❌ FAILED'}`);
  console.log(`   Tx Hash: ${res3.txHash}`);
  console.log(`   Gas Sponsor Amount: ${res3.amount} TYI_MOCK_USD`);
  console.log(`   Execution Mode: ${res3.mode}\n`);
  if (!res3.success) throw new Error('Accept Job flow failed');

  // Flow 4: Submit Acknowledgment (Operator)
  console.log('🔹 FLOW 4: Confirming Printing & Submitting Acknowledgment (Operator)...');
  const res4 = await ugf.submitAcknowledgment(jobId, forensicId, operatorId);
  console.log(`   Result: ${res4.success ? '✅ SUCCESS' : '❌ FAILED'}`);
  console.log(`   Tx Hash: ${res4.txHash}`);
  console.log(`   Gas Sponsor Amount: ${res4.amount} TYI_MOCK_USD`);
  console.log(`   Execution Mode: ${res4.mode}\n`);
  if (!res4.success) throw new Error('Submit Acknowledgment flow failed');

  // Flow 5: Report Leak (Public/System)
  console.log('🔹 FLOW 5: Reporting Document Leak (Public integrity portal)...');
  const res5 = await ugf.reportLeak(jobId, 1, forensicId);
  console.log(`   Result: ${res5.success ? '✅ SUCCESS' : '❌ FAILED'}`);
  console.log(`   Tx Hash: ${res5.txHash}`);
  console.log(`   Gas Sponsor Amount: ${res5.amount} TYI_MOCK_USD`);
  console.log(`   Execution Mode: ${res5.mode}\n`);
  if (!res5.success) throw new Error('Report Leak flow failed');

  // Flow 6: Claim Reward (Admin / Bounty Approval)
  console.log('🔹 FLOW 6: Claiming Bounty Reward (Admin Approved)...');
  const res6 = await ugf.claimReward(leakCaseId, adminId);
  console.log(`   Result: ${res6.success ? '✅ SUCCESS' : '❌ FAILED'}`);
  console.log(`   Tx Hash: ${res6.txHash}`);
  console.log(`   Gas Sponsor Amount: ${res6.amount} TYI_MOCK_USD`);
  console.log(`   Execution Mode: ${res6.mode}\n`);
  if (!res6.success) throw new Error('Claim Reward flow failed');

  console.log('==================================================');
  console.log('🎉 ALL UGF GASLESS FLOW TESTS PASSED SUCCESSFULLY!');
  console.log('==================================================');
}

runE2ETests().catch(err => {
  console.error('\n❌ E2E FLOW TEST RUNNER ENCOUNTERED AN ERROR:', err.message);
  process.exit(1);
});
