import { QdrantClient } from "@qdrant/js-client-rest";
import dotenv from "dotenv";

dotenv.config();

export class QdrantService {
  private readonly client: QdrantClient;

  constructor() {
    const apiKey = process.env.QDRANT_API_KEY;
    if (!apiKey) {
      throw new Error("QDRANT_API_KEY is not defined in environment variables");
    }

    this.client = new QdrantClient({
      url: "https://68194a2d-780c-4869-b0c3-fe80268d8a3b.us-east4-0.gcp.cloud.qdrant.io:6333",
      apiKey,
    });
  }

  async createCollection(collectionName: string, vectorSize: number) {
    try {
      await this.client.createCollection(collectionName, {
        vectors: {
          size: vectorSize,
          distance: "Cosine",
        },
      });
    } catch (error) {
      console.error("Error creating collection:", error);
      throw error;
    }
  }

  async upsertVectors(
    collectionName: string,
    points: Array<{
      id: number;
      vector: number[];
      payload?: Record<string, any>;
    }>
  ) {
    try {
      await this.client.upsert(collectionName, {
        points,
      });
    } catch (error) {
      console.error("Error upserting vectors:", error);
      throw error;
    }
  }

  async search(collectionName: string, vector: number[], limit: number = 5) {
    try {
      const response = await this.client.search(collectionName, {
        vector,
        limit,
      });
      return response.map((hit) => ({
        payload: hit.payload as { text: string; report_date: string },
      }));
    } catch (error) {
      console.error("Error searching vectors:", error);
      throw error;
    }
  }

  async collectionExists(collectionName: string): Promise<boolean> {
    try {
      await this.client.getCollection(collectionName);
      return true;
    } catch {
      return false;
    }
  }

  async createCollectionIfNotExists(
    collectionName: string,
    vectorSize: number
  ) {
    try {
      if (!(await this.collectionExists(collectionName))) {
        await this.createCollection(collectionName, vectorSize);
      }
    } catch (error) {
      console.error("Error creating collection:", error);
      throw error;
    }
  }
}
