import hre from "hardhat";

async function main() {
  console.log("HRE keys:", Object.keys(hre));
  if (hre.ethers) {
    const PrintFlow = await hre.ethers.getContractFactory("PrintFlow");
    console.log("Deploying PrintFlow...");
    const printFlow = await PrintFlow.deploy();
    await printFlow.waitForDeployment();
    const address = await printFlow.getAddress();
    console.log(`PrintFlow deployed to: ${address}`);
  } else {
    console.log("hre.ethers is undefined!");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
