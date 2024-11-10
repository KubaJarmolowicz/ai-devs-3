import axios from "axios";
import dotenv from "dotenv";
import { runPoligon } from "./tasks/poligon";

dotenv.config();

async function main() {
  try {
    console.log("AI Challenges App Started!");
    await runPoligon();
  } catch (error) {
    console.error("Error:", error);
  }
}

main();
