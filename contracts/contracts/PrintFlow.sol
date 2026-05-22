// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

contract PrintFlow is Ownable {
    enum JobStatus { Pending, Assigned, Printing, Completed }

    struct Job {
        uint id;
        string jobRef;
        uint copiesCount;
        address operator;
        JobStatus status;
        string forensicId;
    }

    struct LeakCase {
        uint id;
        uint jobId;
        uint copyNumber;
        string forensicId;
        bool claimed;
        uint rewardAmount;
        address reporter;
    }

    uint public nextJobId;
    uint public nextLeakCaseId;

    mapping(uint => Job) public jobs;
    mapping(uint => LeakCase) public leakCases;

    event JobCreated(uint indexed jobId, string jobRef, address indexed admin);
    event JobAssigned(uint indexed jobId, address indexed operator);
    event JobAccepted(uint indexed jobId, address indexed operator);
    event AcknowledgmentSubmitted(uint indexed jobId, string forensicId);
    event LeakReported(uint indexed leakCaseId, uint indexed jobId, uint copyNumber);
    event RewardClaimed(uint indexed leakCaseId, address indexed reporter, uint amount);

    constructor() Ownable(msg.sender) {}

    function createJob(string memory jobRef, uint copiesCount) external onlyOwner returns (uint) {
        uint jobId = nextJobId++;
        jobs[jobId] = Job({
            id: jobId,
            jobRef: jobRef,
            copiesCount: copiesCount,
            operator: address(0),
            status: JobStatus.Pending,
            forensicId: ""
        });
        emit JobCreated(jobId, jobRef, msg.sender);
        return jobId;
    }

    function assignJob(uint jobId, address operator) external onlyOwner {
        require(jobId < nextJobId, "Job does not exist");
        Job storage job = jobs[jobId];
        job.operator = operator;
        job.status = JobStatus.Assigned;
        emit JobAssigned(jobId, operator);
    }

    function acceptJob(uint jobId) external {
        require(jobId < nextJobId, "Job does not exist");
        Job storage job = jobs[jobId];
        require(msg.sender == job.operator || msg.sender == owner(), "Not authorized");
        job.status = JobStatus.Printing;
        emit JobAccepted(jobId, msg.sender);
    }

    function submitAcknowledgment(uint jobId, string memory forensicId) external {
        require(jobId < nextJobId, "Job does not exist");
        Job storage job = jobs[jobId];
        require(msg.sender == job.operator || msg.sender == owner(), "Not authorized");
        job.status = JobStatus.Completed;
        job.forensicId = forensicId;
        emit AcknowledgmentSubmitted(jobId, forensicId);
    }

    function reportLeak(uint jobId, uint copyNumber, string memory forensicId) external returns (uint) {
        uint leakCaseId = nextLeakCaseId++;
        leakCases[leakCaseId] = LeakCase({
            id: leakCaseId,
            jobId: jobId,
            copyNumber: copyNumber,
            forensicId: forensicId,
            claimed: false,
            rewardAmount: 0,
            reporter: msg.sender
        });
        emit LeakReported(leakCaseId, jobId, copyNumber);
        return leakCaseId;
    }

    function claimReward(uint leakCaseId) external onlyOwner {
        require(leakCaseId < nextLeakCaseId, "Leak case does not exist");
        LeakCase storage lc = leakCases[leakCaseId];
        require(!lc.claimed, "Reward already claimed");
        lc.claimed = true;
        lc.rewardAmount = 100 * 10**18; // 100 Mock USD
        // In a real application, token transfer would happen here
        emit RewardClaimed(leakCaseId, lc.reporter, lc.rewardAmount);
    }
}
