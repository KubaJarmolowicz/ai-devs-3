import axios from "axios";
import dotenv from "dotenv";
import { readdir, readFile } from "fs/promises";
import { join } from "path";
import { OpenAIService } from "../services/OpenAIService";
import path from "path";

dotenv.config();

interface FactEntities {
  [key: string]: string;
}

interface KeywordAnalysis {
  reportFile: string;
  keywords: string[];
  matchingFacts: string[];
}

export const runDokumenty = async () => {
  try {
    const openAIService = new OpenAIService();
    const factsDir = path.join(__dirname, "../resources/facts");
    const reportsDir = path.join(__dirname, "../resources/files");

    // Step 1: Analyze fact files for entities
    const factEntities: FactEntities = {};
    const factFiles = await readdir(factsDir);

    for (const file of factFiles) {
      if (!file.endsWith(".txt")) continue;
      const content = await readFile(join(factsDir, file), "utf-8");
      const prompt = `Extract all names of people and locations from the following text.
      Extract any crucial information that might help to identify person described in the text (job, special skills, physical features etc.).
      Return them as a comma-separated list:\n\n ${content}
      `;
      const entities = await openAIService.getAnswer(prompt);
      factEntities[file] = entities;
    }

    // Step 2: Analyze reports and match with facts
    const reports = await readdir(reportsDir);
    const analyses: KeywordAnalysis[] = [];

    for (const report of reports) {
      if (!report.endsWith(".txt")) continue;

      const reportContent = await readFile(join(reportsDir, report), "utf-8");
      const matchingFacts = findMatchingFacts(reportContent, factEntities);

      const factsContent = await Promise.all(
        matchingFacts.map((file) => readFile(join(factsDir, file), "utf-8"))
      );

      const fullContext =
        matchingFacts.length > 0
          ? `### facts content: ${factsContent} ### \n *** report content: ${reportContent} *** report name: ${report}`
          : `*** report content: ${reportContent} *** report name: ${report}`;

      const prompt = `As an intelligence analyst, analyze this report and related facts to extract KEY INFORMATION.

1. First, identify the sector from the report name.

2. Then, carefully analyze the content to identify and extract:
   - KEY PEOPLE: Their names, roles, skills, status (e.g., "Jan Nowak", "Python expert", "zaginiony")
   - KEY LOCATIONS: Specific places, rooms, areas (e.g., "pokój 105", "strefa wschodnia")
   - KEY EVENTS: Important activities or incidents (e.g., "włamanie do systemu", "patrol")
   - KEY TECHNICAL INFO: Systems, tools, equipment status (e.g., "system XR-5 nieaktywny")
   - KEY TIMES: Specific times and dates when events occurred
   - KEY STATUS INFO: Current situation, conditions, threats

IMPORTANT:
- DO NOT repeat the entire text
- DO NOT include generic descriptions
- Extract only SIGNIFICANT keywords that would be useful for searching
- Each keyword should be a specific, meaningful piece of information

Return as a comma-separated list of concise, specific keywords.

Content to analyze:\n\n${fullContext}`;
      const keywordsString = await openAIService.getAnswer(prompt);
      const keywords = keywordsString.split(",").map((k) => k.trim());

      analyses.push({
        reportFile: report,
        keywords,
        matchingFacts,
      });
    }

    console.log("Analyses: ", analyses);

    // Transform analyses into required format
    const result = analyses.reduce((acc, analysis) => {
      acc[analysis.reportFile] = analysis.keywords.join(", ");
      return acc;
    }, {} as Record<string, string>);

    // Send to reporting
    const API_KEY = process.env.API_KEY;
    const verifyResponse = await axios.post(
      "https://centrala.ag3nts.org/report",
      {
        task: "dokumenty",
        apikey: API_KEY,
        answer: result,
      }
    );

    console.log("Verification:", verifyResponse.data);
    return result;
  } catch (error) {
    console.error("Error in dokumentyTask:", error);
  }
};

const findMatchingFacts = (
  reportContent: string,
  factEntities: FactEntities
): string[] => {
  const matchingFacts: string[] = [];

  for (const [factFile, entities] of Object.entries(factEntities)) {
    const entityList = entities.split(", ");
    if (entityList.some((entity) => reportContent.includes(entity))) {
      matchingFacts.push(factFile);
    }
  }

  return matchingFacts;
};
