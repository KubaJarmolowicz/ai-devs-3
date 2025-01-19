import axios from "axios";
import dotenv from "dotenv";
import { DatabaseService } from "../services/DatabaseService";
import { OpenAIService } from "../services/OpenAIService";

dotenv.config();

const question =
  "Które aktywne datacenter (DC_ID) są zarządzane przez pracowników, którzy są na urlopie (is_active=0)?";

export async function runDatabase() {
  const dbService = new DatabaseService();
  const openaiService = new OpenAIService();

  try {
    // Query to get all table names in most SQL databases
    const query = "show tables";

    const tables = await dbService.sendQuery<{ table_name: string }[]>(query);

    console.log("Tables:", tables);

    const tableNames = tables.map((table) => Object.values(table)[0]);

    console.log("Table names:", tableNames);

    const pickTablesSystemMsg = `You are a SQL expert. Your task is to analyze a question and list of available tables, then return ONLY the table names needed to answer the question. Respond with just the table names as comma-separated values, nothing else.`;

    const pickTablesPrompt = `Question: "${question}"
Available tables: ${tableNames.join(", ")}

Return only the relevant table names as comma-separated values.`;

    const pickedTables = (
      await openaiService.getAnswer(pickTablesPrompt, pickTablesSystemMsg)
    ).split(",");

    console.log("Picked tables:", pickedTables);

    const structures = [];

    for (const table of pickedTables) {
      const query = `show create table ${table.trim().toLowerCase()}`;
      const structure = (await dbService.sendQuery<any>(query))[0];
      structures.push(structure);
      console.log(`Structure for ${table}:`, structure);
    }

    const generateQuerySystemMsg = `You are a SQL expert. Given table structures and a question, respond ONLY with the raw SQL query. No markdown, no SQL tags, no decorators, no explanations - just the pure SQL query text.`;

    const generateQueryPrompt = `Question: "${question}"
Table structures:
${structures.map((s) => Object.values(s)[1]).join("\n")}

Return only the raw SQL query, with no decorators or markdown.`;

    const sqlQuery = await openaiService.getAnswer(
      generateQueryPrompt,
      generateQuerySystemMsg
    );
    console.log("Generated query:", sqlQuery);

    const result = await dbService.sendQuery(sqlQuery);
    console.log("Query result:", result);

    const answer = result.map(({ dc_id }) => dc_id);

    console.log("Answer:", answer);

    // Report the answer
    const verifyResponse = await axios.post(
      "https://centrala.ag3nts.org/report",
      {
        task: "database",
        apikey: process.env.API_KEY,
        answer,
      }
    );

    console.log("Verification:", verifyResponse.data);
  } catch (error) {
    console.error("Error in database task:", error);
    throw error;
  }
}
