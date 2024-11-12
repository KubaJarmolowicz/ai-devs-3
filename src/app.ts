import dotenv from "dotenv";
import { runPoligon } from "./tasks/poligon";
import { runXYZChallenge } from "./tasks/xyz-challenge";
import { runVerifyAgent } from "./tasks/verify-agent";

dotenv.config();

async function main() {
  try {
    console.log("AI Challenges App Started!");
    // await runPoligon();
    //await runXYZChallenge();
    await runVerifyAgent();
  } catch (error) {
    console.error("Error:", error);
  }
}

main();
