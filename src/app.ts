import dotenv from "dotenv";
import { runPoligon } from "./tasks/poligon";
import { runXYZChallenge } from "./tasks/xyz-challenge";
import { runVerifyAgent } from "./tasks/verify-agent";
import { runJsonChallenge } from "./tasks/json-challenge";
import { runCensorship } from "./tasks/censorship";
import { runMp3 } from "./tasks/mp3";
import { runMap } from "./tasks/map";
import { runRobotIdTask } from "./tasks/robotid";
import { runKategorie } from "./tasks/kategorie";
import { analyzeArxivDraft } from "./tasks/arxiv";
import { runDokumenty } from "./tasks/dokumenty";
import { runWektory } from "./tasks/wektory";
import { runDatabase } from "./tasks/database";
dotenv.config();

async function main() {
  try {
    console.log("AI Challenges App Started!");
    // await runPoligon();
    // await runXYZChallenge();
    // await runVerifyAgent();
    // await runJsonChallenge();
    // await runCensorship();
    //await runMp3();
    // await runMap();
    // await runRobotIdTask();
    //await runKategorie();
    //await analyzeArxivDraft();
    //await runDokumenty();
    //await runWektory();
    await runDatabase();
  } catch (error) {
    console.error("Error data:", error);
  }
}

main();
