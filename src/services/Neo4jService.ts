import { Driver, driver, auth } from "neo4j-driver";
import dotenv from "dotenv";

dotenv.config();

export class Neo4jService {
  private driver: Driver;

  constructor() {
    const uri = process.env.NEO4J_URI;
    const user = process.env.NEO4J_USER;
    const password = process.env.NEO4J_PASSWORD;

    if (!uri || !user || !password) {
      throw new Error("Neo4j credentials not found in environment variables");
    }

    this.driver = driver(uri, auth.basic(user, password));
  }

  async executeQuery<T = any>(query: string): Promise<T[]> {
    const session = this.driver.session();
    try {
      const result = await session.run(query);
      return result.records.map((record) => record.get(0));
    } finally {
      await session.close();
    }
  }

  async close() {
    await this.driver.close();
  }
}
