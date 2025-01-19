import dotenv from "dotenv";
import axios from "axios";
import { OpenAIService } from "../services/OpenAIService";
import { Neo4jService } from "../services/Neo4jService";

dotenv.config();

export async function runConnections() {
  const openaiService = new OpenAIService();
  const neo4jService = new Neo4jService();

  try {
    const systemPrompt = `You are a Neo4j expert. Generate a Cypher query that:
    1. Finds the shortest path between two users using KNOWS relationships
    2. Returns the path as a list of usernames
    3. Uses MATCH and SHORTESTPATH functions
    Return only the raw Cypher query, nothing else.`;

    const queryPrompt = `Create a Cypher query to find the shortest path from user with username 'Rafał' to user with username 'Barbara' through KNOWS relationships.
    The query should return the path as a sequence of usernames. IMPORTANT: Return only the Cypher query, nothing else, no formatting.`;

    const cypherQuery = await openaiService.getAnswer(
      queryPrompt,
      systemPrompt
    );

    const result = await neo4jService.executeQuery(cypherQuery);
    const answer = result[0]?.join(", ");

    const verifyResponse = await axios.post(
      "https://centrala.ag3nts.org/report",
      {
        task: "connections",
        apikey: process.env.API_KEY,
        answer,
      }
    );

    console.log("Verification:", verifyResponse.data);
  } catch (error) {
    console.error("Error in connections task:", error);
    throw error;
  } finally {
    await neo4jService.close();
  }
}
