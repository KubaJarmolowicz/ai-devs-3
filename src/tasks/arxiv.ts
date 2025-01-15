import puppeteer from "puppeteer";
import { OpenAIService } from "../services/OpenAIService";
import * as fs from "fs/promises";
import axios from "axios";

interface ContentSection {
  title: string;
  content: string;
  hasImage: boolean;
  hasAudio: boolean;
  imagePath?: string;
  audioPath?: string;
}

export async function analyzeArxivDraft() {
  const openAIService = new OpenAIService();
  const url = "https://centrala.ag3nts.org/dane/arxiv-draft.html";

  try {
    // 1. Scrape the content
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    await page.goto(url);

    // 2. Extract sections by h2
    const sections = await page.evaluate(() => {
      const result: ContentSection[] = [];
      const h2Elements = document.querySelectorAll("h2");

      h2Elements.forEach((h2) => {
        let currentNode = h2.nextElementSibling;
        let content = "";
        let hasImage = false;
        let hasAudio = false;
        let imagePath = "";
        let audioPath = "";
        let imageCaption = "";

        while (currentNode && currentNode.tagName !== "H2") {
          if (currentNode.tagName === "FIGURE") {
            const img = currentNode.querySelector("img");
            const figcaption = currentNode.querySelector("figcaption");

            if (img) {
              hasImage = true;
              imagePath = img.getAttribute("src") || "";
              if (figcaption) {
                imageCaption = figcaption.textContent || "";
                content += `Image caption: ${imageCaption}\n`;
              }
            }
          } else if (currentNode.tagName === "IMG") {
            hasImage = true;
            imagePath = currentNode.getAttribute("src") || "";
          } else if (currentNode.tagName === "AUDIO") {
            hasAudio = true;
            const audioElement = currentNode.querySelector("source");
            audioPath = audioElement?.src || "";
          } else if (currentNode.tagName !== "FIGCAPTION") {
            // Skip standalone figcaptions as they're handled with their figures
            content += currentNode.textContent + "\n";
          }
          currentNode = currentNode.nextElementSibling;
        }

        result.push({
          title: h2.textContent || "",
          content: content.trim(),
          hasImage,
          hasAudio,
          ...(imagePath && { imagePath }),
          ...(audioPath && { audioPath }),
        });
      });

      return result;
    });

    await browser.close();

    // 3. Process sections in parallel batches
    console.log("Processing all sections...", { sections });

    // Prepare configs for all sections
    const sectionConfigs = sections.map((section) => ({
      section,
      config: {
        fileType: section.hasImage
          ? "image"
          : section.hasAudio
          ? "audio"
          : "text",
        content: section.content,
        ...(section.imagePath && {
          filePath: section.imagePath.startsWith("http")
            ? section.imagePath
            : `https://centrala.ag3nts.org/dane/${section.imagePath}`,
        }),
        ...(section.audioPath && { filePath: section.audioPath }),
      } as const,
    }));

    // Process sections sequentially with delay
    console.log("Getting analyses...");
    const analyses = [];
    for (const { section, config } of sectionConfigs) {
      console.log(`Analyzing section: ${section.title}`);

      console.log("-----------> config content:", config.content);
      const analysis = await openAIService.analyzeContent(config);
      analyses.push({
        title: section.title,
        type: config.fileType,
        content: section.content,
        analysis,
      });

      //await delay(2000); // 2 second delay between API calls
    }

    // Process summaries sequentially with delay
    const summaries = [];
    for (const { title, type, content, analysis } of analyses) {
      console.log(`Summarizing section: ${title}`);
      const combinedContent =
        type === "audio"
          ? `Text content: ${content}\nAudio transcription: ${analysis}`
          : type === "image"
          ? `Text content: ${content}\nImage description: ${analysis}`
          : analysis;

      console.log("-----------> analysis to summarize:", combinedContent);

      const finalAnalysis = await openAIService.summarizeContent(
        analysis,
        type
      );

      summaries.push({
        title,
        type,
        analysis: finalAnalysis,
      });

      //await delay(2000); // 2 second delay between API calls
    }

    // Build markdown from results
    let markdownOutput = "# Arxiv Draft Analysis\n\n";

    summaries.forEach(({ title, type, analysis }) => {
      markdownOutput += `## ${title}\n\n`;
      markdownOutput += `**Content Type:** ${type}\n`;
      markdownOutput += `**Analysis:** ${analysis}\n\n`;
      markdownOutput += "---\n\n";
    });

    // 4. Save the analysis
    await fs.writeFile("arxiv-analysis-image.md", markdownOutput);
    console.log("Analysis complete. Results saved to arxiv-analysis.md");

    // 5. Download questions
    const questionsResponse = await axios.get<string>(
      `https://centrala.ag3nts.org/data/${process.env.API_KEY}/arxiv.txt`
    );
    const questionLines = questionsResponse.data.split("\n");
    const [questionIds, questions] = questionLines.reduce<[string[], string[]]>(
      (acc, line) => {
        const [id, question] = line.split("=");
        acc[0].push(id);
        acc[1].push(question);
        return acc;
      },
      [[], []]
    );

    // 6. Get markdown content
    const markdownContent = await fs.readFile("arxiv-analysis.md", "utf-8");

    // 7. Get answers from GPT
    const answers = await openAIService.getAnswers(questionLines, {
      context: markdownContent,
      formatAsObject: true,
      questionIds,
    });
    console.log("Answers:", answers);

    // 8. Send answers to API
    const verifyResponse = await axios.post(
      "https://centrala.ag3nts.org/report",
      {
        task: "arxiv",
        apikey: process.env.API_KEY,
        answer: JSON.parse(answers),
      }
    );

    console.log("Verification:", verifyResponse.data);
  } catch (error) {
    console.error("Error analyzing arxiv draft:", error);
    throw error;
  }
}
