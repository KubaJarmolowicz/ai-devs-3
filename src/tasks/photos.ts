import dotenv from "dotenv";
import axios from "axios";
import { OpenAIService } from "../services/OpenAIService";

dotenv.config();

function getFilenameFromUrl(url: string): string {
  return url.split("/").pop() || url;
}

const normalizePhotos = async (
  photosWithActions: { url: string; action: string }[],
  openaiService: OpenAIService,
  iteration: number = 1
): Promise<{ url: string; action: string }[]> => {
  if (iteration > 5) {
    throw new Error("Maximum iteration limit (5) reached in normalizePhotos");
  }

  if (photosWithActions.every((photo) => photo.action === "SKIP")) {
    return photosWithActions;
  }

  for (const photo of photosWithActions) {
    const shouldSkipPrecessing = photo.action === "SKIP";

    if (shouldSkipPrecessing) {
      continue;
    }

    const analysis = await openaiService.analyzeImagesFromUrls(
      photo.url,
      `Analyze this image and determine if it needs processing before facial recognition analysis.
Return ONLY ONE of these words: REPAIR, DARKEN, BRIGHTEN, or SKIP.
No other text or explanation.`
    );
    console.log(`Photo ${photo.url}: ${analysis.trim()}`);
    photo.action = analysis.trim();
  }

  console.log("photosWithActions:", photosWithActions);

  for (const photo of photosWithActions) {
    const shouldSkipPrecessing = photo.action === "SKIP";

    if (shouldSkipPrecessing) {
      continue;
    }

    const filename = getFilenameFromUrl(photo.url);
    const response = await axios.post<{ message: string }>(
      "https://centrala.ag3nts.org/report",
      {
        task: "photos",
        apikey: process.env.API_KEY,
        answer: `${photo.action} ${filename}`,
      }
    );

    console.log("Response after processing:", response.data);

    const extractUrlsPrompt = `You are a photo URL extractor. Analyze the message and extract complete photo URLs or construct them from provided information.

Rules:
- If complete URL is provided (e.g. "https://example.com/photos/IMG_123_MOD.PNG"), extract them directly and return it
- If filenames are provided with a base URL, combine them (e.g. from "files at https://example.com/photos/: IMG_123.PNG")
- If no URL base is provided, assume it is the same as in the original URL and just swap the filename for the new one.
- Only include .PNG files
- Remove any duplicates
- Return ONLY ONE, NEW URL, nothing else, no description, no markdown, no formatting.`;

    const newUrl = await openaiService.getAnswer(
      `Extract complete photo URL from this message. URL of original photo: ${photo.url}. Message: ${response.data.message}`,
      extractUrlsPrompt
    );
    console.log("newUrl:", newUrl);

    photo.url = newUrl;
  }

  return normalizePhotos(photosWithActions, openaiService, iteration + 1);
};

export async function runPhotos() {
  const openaiService = new OpenAIService();

  try {
    const response = await axios.post<{ message: string }>(
      "https://centrala.ag3nts.org/report",
      {
        task: "photos",
        apikey: process.env.API_KEY,
        answer: "START",
      }
    );
    console.log("Response:", response.data);

    const extractUrlsPrompt = `You are a photo URL extractor. Analyze the message and extract complete photo URLs or construct them from provided information.

        Rules:
        - If complete URLs are provided (e.g. "https://example.com/photos/IMG_123.PNG"), extract them directly
        - If filenames are provided with a base URL, combine them (e.g. from "files at https://example.com/photos/: IMG_123.PNG")
        - Return a JSON array of complete, valid URLs (no markdown, no formatting, ONLY A JSON ARRAY)
        - Only include .PNG files
        - Remove any duplicates
        - Format: ["https://example.com/photos/IMG_123.PNG", ...]`;

    const photos = await openaiService.getAnswer(
      `Extract complete photo URLs from this message. If only filenames are provided with a base URL path, construct the complete URLs: ${response.data.message}`,
      extractUrlsPrompt
    );

    console.log("photos:", photos);
    const photoUrls = JSON.parse(photos);
    console.log("photoUrls:", photoUrls);

    const photosWithActions = await normalizePhotos(
      photoUrls.map((url: string) => ({ url, action: "" })),
      openaiService
    );

    console.log("photosWithActions:", photosWithActions);

    const processedUrls = photosWithActions.map((photo) => photo.url);

    console.log("processedUrls:", processedUrls);

    const personPrompt = `Opisz dokładnie co widzisz na zdjęciach.

WAŻNE:
- Odpowiadaj tylko po polsku`;

    const personDescription = await openaiService.analyzeImagesFromUrls(
      processedUrls,
      personPrompt
    );
    console.log("Person description:", personDescription);

    const verifyResponse = await axios.post(
      "https://centrala.ag3nts.org/report",
      {
        task: "photos",
        apikey: process.env.API_KEY,
        //answer: personDescription,
        answer: personDescription,
      }
    );
    console.log("Verification:", verifyResponse.data);

    return;
  } catch (error) {
    console.error("Error in photos task:", (error as any).response?.data);
  }
}
