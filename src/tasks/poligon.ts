import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

interface VerifyResponse {
  code: number;
  msg: string;
  note?: string;
}

export async function runPoligon() {
  try {
    const dataResponse = await axios.get<string>(
      `${process.env.API_URL}/dane.txt`
    );
    const strings: string[] = dataResponse.data.split("\n").filter(Boolean);

    const verifyResponse = await axios.post<VerifyResponse>(
      `${process.env.API_URL}/verify`,
      {
        task: "POLIGON",
        apikey: process.env.API_KEY,
        answer: strings,
      }
    );

    console.log("Weryfikacja:", verifyResponse.data);
  } catch (error) {
    if (error instanceof Error && "isAxiosError" in error) {
      console.error(
        "Błąd axios:",
        (error as any).response?.data || error.message
      );
    } else {
      console.error("Błąd:", error);
    }
  }
}
