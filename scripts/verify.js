import hre from "hardhat";

async function main() {
    // In Hardhat v3 ESM, plugins strictly inject into hre
    console.log("Checking if ethers is available in HRE...");
    if (!hre.ethers) {
        throw new Error("HRE.ethers is undefined. Hardhat-ethers plugin failed to load.");
    }

    const [deployer] = await hre.ethers.getSigners();
    console.log("Deploying contracts with the account:", deployer.address);

    const AgentRegistry = await hre.ethers.getContractFactory("AgentRegistry");
    const registry = await AgentRegistry.deploy();

    if (registry.waitForDeployment) {
        await registry.waitForDeployment();
        console.log("AgentRegistry deployed to:", await registry.getAddress());
        console.log("Deploy Tx:", registry.deploymentTransaction().hash);
    } else {
        await registry.deployed();
        console.log("AgentRegistry deployed to:", registry.address);
    }

    // 1. Register Agent
    const did = "did:ethr:0x1234567890123456789012345678901234567890";
    const cid = "QmTestHash1234567890";
    const stakeAmount = hre.ethers.parseEther("0.02");

    console.log(`Registering agent with DID: ${did} and Stake: 0.02 ETH...`);
    const tx = await registry.registerAgent(did, cid, { value: stakeAmount });
    await tx.wait();
    console.log("Agent Registered!");

    // 2. Check Agent Data
    // We pass the string address explicitly to avoid object issues
    const agentData = await registry.getAgent(deployer.address);
    console.log("Agent Data retrieved:");
    console.log("- DID:", agentData.did);
    console.log("- InitScore:", agentData.initScore.toString());
    console.log("- Stake:", hre.ethers.formatEther(agentData.stakeAmount), "ETH");

    if (agentData.initScore.toString() === "80") {
        console.log("SUCCESS: Init Score is 80 (Tier 1 correct)");
    } else {
        console.error("FAILURE: Init Score incorrect");
    }

    // 3. Slash Agent
    console.log("Slashing agent...");
    const slashTx = await registry.slash(
        deployer.address,
        10,
        hre.ethers.parseEther("0.01"),
        "Malicious behavior test"
    );
    await slashTx.wait();
    console.log("Agent Slashed!");

    // 4. Verify Slashed State
    const agentDataAfter = await registry.getAgent(deployer.address);
    console.log("Agent Data after Slash:");
    console.log("- AccumulatedPenalty:", agentDataAfter.accumulatedPenalty.toString());
    console.log("- Stake:", hre.ethers.formatEther(agentDataAfter.stakeAmount), "ETH");

    if (agentDataAfter.accumulatedPenalty.toString() === "10") {
        console.log("SUCCESS: Penalty recorded");
    } else {
        console.error("FAILURE: Penalty not recorded");
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
