import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

interface DatabaseQueryRequest {
  task: "database";
  apikey: string;
  query: string;
}

interface DatabaseResponse<T = any> {
  reply: T[];
  error: string;
}

export class DatabaseService {
  private readonly apiUrl = "https://centrala.ag3nts.org/apidb";
  private readonly apiKey: string;

  constructor() {
    if (!process.env.API_KEY) {
      throw new Error("API_KEY is not defined in environment variables");
    }
    this.apiKey = process.env.API_KEY;
  }

  async sendQuery<T = any>(query: string): Promise<T[]> {
    const payload: DatabaseQueryRequest = {
      task: "database",
      apikey: this.apiKey,
      query,
    };

    try {
      console.log("Sending query:", query);
      const response = await axios.post<DatabaseResponse<T>>(
        this.apiUrl,
        payload,
        {
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      if (response.data.error !== "OK") {
        throw new Error(`Database error: ${response.data.error}`);
      }

      return response.data.reply;
    } catch (error: unknown) {
      console.error("Database query failed:", {
        error,
        payload,
      });
      throw error;
    }
  }
}
