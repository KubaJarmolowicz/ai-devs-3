import dotenv from "dotenv";
import { OpenAIService } from "../services/OpenAIService";
import path from "path";

dotenv.config();

export async function runFineTuning() {
  try {
    const service = new OpenAIService();

    // Construct proper file paths
    const correctFile = path.join(
      __dirname,
      "../resources/research/correct.txt"
    );
    const incorrectFile = path.join(
      __dirname,
      "../resources/research/incorrect.txt"
    );

    console.log("Starting model fine-tuning...");
    const jobId = await service.trainPatternModel(correctFile, incorrectFile);
    console.log(`Fine-tuning job created with ID: ${jobId}`);

    // Initial status check
    let status = await service.getFineTuningStatus(jobId);
    console.log(`Initial status: ${status}`);

    // Poll status every 30 seconds until complete
    while (status !== "succeeded" && status !== "failed") {
      await new Promise((resolve) => setTimeout(resolve, 0.5 * 60 * 1000));
      status = await service.getFineTuningStatus(jobId);
      console.log(`Current status: ${status}`);
    }

    if (status === "succeeded") {
      const job = await service.getFineTuningJobDetails(jobId);
      console.log("Job details:", job);

      const modelId = job.fine_tuned_model;
      console.log("Fine-tuning completed successfully!");
      console.log(`Your fine-tuned model ID is: ${modelId}`);
      console.log("\nAdd this to your .env file:");
      console.log(`RESEARCH_MODEL_ID="${modelId}"`);
    } else {
      console.error(
        "Fine-tuning failed. Please check the OpenAI dashboard for details."
      );
    }
  } catch (error) {
    console.error("Error during fine-tuning:", error);
  }
}

// Run if this file is executed directly
if (require.main === module) {
  runFineTuning().catch(console.error);
}
