import { OpenAIService } from "../services/OpenAIService";
import axios from "axios";
import dotenv from "dotenv";
import { JSDOM } from "jsdom";

dotenv.config();

interface URLScore {
  url: string;
  relevanceScore: number;
  questionIds: string[];
  reasoning: string;
}

interface Questions {
  [key: string]: string;
}

interface ContentValidation {
  isValid: boolean;
  confidence: number;
  reasoning: string;
}

interface StepCounts {
  [questionId: string]: number;
}

interface StepResult {
  canProceed: boolean;
  remainingSteps: number;
}

interface ContentChunk {
  id: string;
  content: string;
  embedding?: number[];
  urls: URLNode[];
  parentChunkId?: string;
}

interface URLNode {
  id: string;
  url: string;
  relevanceScore: number;
  questionIds: string[];
  parentChunkId: string;
  visited: boolean;
  confidence: number;
}

interface ExplorationState {
  currentChunkId: string;
  visitedUrls: Set<string>;
  urlQueue: PriorityQueue<URLNode>;
  contentCache: Map<string, ContentChunk>;
  stepCounts: Record<string, number>;
  answers: Map<string, Answer>;
}

interface Answer {
  questionId: string;
  content: string;
  confidence: number;
  sourcePath: string[];
  preview?: string;
  reasoning?: string;
}

interface URLMetadata {
  url: string;
  text: string; // Content of the <a> tag
  title?: string; // Title attribute if present
  context?: string; // Surrounding text
  scores: Map<string, { score: number; reasoning: string }>; // Scores per question
}

type Action =
  | { type: "VISIT"; url: string }
  | { type: "SCRAPE"; url: string }
  | { type: "PARSE"; content: string; url?: string }
  | { type: "VALIDATE"; chunkId: string; contentPreview?: string }
  | { type: "REASON"; context: string }
  | { type: "ANSWER"; answer: Answer }
  | { type: "SUMMARIZE"; chunkIds: string[] }
  | { type: "COMPARE"; answers: Answer[] }
  | { type: "BACKTRACK"; to: string }
  | { type: "YIELD"; reason: string; url?: string }
  | { type: "CHUNKS"; count: number; firstChunk?: string };

// Priority Queue implementation for URL processing
class PriorityQueue<T extends URLNode> {
  private items: T[] = [];

  enqueue(item: T): void {
    const score = item.relevanceScore * (1 + item.confidence);
    let added = false;

    for (let i = 0; i < this.items.length; i++) {
      const currentScore =
        this.items[i].relevanceScore * (1 + this.items[i].confidence);
      if (score > currentScore) {
        this.items.splice(i, 0, item);
        added = true;
        break;
      }
    }

    if (!added) {
      this.items.push(item);
    }
  }

  dequeue(): T | undefined {
    return this.items.shift();
  }

  isEmpty(): boolean {
    return this.items.length === 0;
  }
}

export class WebScraper {
  private openAIService: OpenAIService;
  private questions: Questions;
  private stepCounts: StepCounts;
  private state: ExplorationState;
  private debugLog: string[] = [];
  private readonly MAX_STEPS = 10;
  private readonly BASE_URL = "https://softo.ag3nts.org";
  private urlMetadataCache: Map<string, URLMetadata> = new Map();

  constructor(questions: Questions, openAIService: OpenAIService) {
    this.openAIService = openAIService;
    this.questions = questions;
    this.stepCounts = Object.keys(questions).reduce((acc, qId) => {
      acc[qId] = 0;
      return acc;
    }, {} as StepCounts);
    this.state = {
      currentChunkId: "root",
      visitedUrls: new Set(),
      urlQueue: new PriorityQueue(),
      contentCache: new Map(),
      stepCounts: this.stepCounts,
      answers: new Map(),
    };
  }

  checkStep(questionIds: string[]): StepResult[] {
    return questionIds.map((qId) => {
      const remainingSteps = this.MAX_STEPS - (this.stepCounts[qId] || 0);
      return {
        canProceed: remainingSteps > 0,
        remainingSteps,
      };
    });
  }

  incrementSteps(questionIds: string[]): void {
    questionIds.forEach((qId) => {
      this.stepCounts[qId] = (this.stepCounts[qId] || 0) + 1;
    });
  }

  getStepCounts(): StepCounts {
    return { ...this.stepCounts };
  }

  private getJsonPrompt(content: string, format: string): string {
    return `IMPORTANT: Return ONLY a JSON object. No text before or after. No markdown. No code blocks. No explanations.

Content to analyze:
${content}

Required JSON format:
${format}`;
  }

  private async generateRelevantTerms(): Promise<Record<string, string[]>> {
    const format = `{
  "01": ["term1", "term2"],
  "02": ["term1", "term2"]
}`;

    const response = await this.openAIService.getAnswer(
      this.getJsonPrompt(
        Object.entries(this.questions)
          .map(([id, q]) => `${id}: ${q}`)
          .join("\n"),
        format
      )
    );
    return JSON.parse(response) as Record<string, string[]>;
  }

  private async scoreUrl(
    url: string,
    questionId: string,
    metadata: URLMetadata
  ): Promise<URLScore & { reasoning: string }> {
    const prompt = `Analyze this URL:
URL: ${url}
Link text: ${metadata.text}
Title: ${metadata.title || "none"}
Context: ${metadata.context}

Question: ${this.questions[questionId]}

How likely is this URL to lead to the answer? Consider all provided information.

RESPOND WITH RAW JSON ONLY. NO BACKTICKS. NO FORMATTING. EXAMPLE:
{"relevanceScore":0.8,"reasoning":"explanation"}

YOUR RESPONSE:`;

    try {
      const response = await this.openAIService.getAnswer(prompt);
      const result = JSON.parse(response) as {
        relevanceScore: number;
        reasoning: string;
      };

      console.log(`URL ${url} scored for Q${questionId}:`, result);
      return {
        url,
        relevanceScore: result.relevanceScore,
        questionIds: [questionId],
        reasoning: result.reasoning,
      };
    } catch (error) {
      console.log(`Error scoring URL ${url}:`, error);
      return {
        url,
        relevanceScore: 0,
        questionIds: [],
        reasoning: "Error during scoring",
      };
    }
  }

  async validateContent(content: string): Promise<ContentValidation> {
    const format = `{
  "isValid": boolean,
  "confidence": number_between_0_and_1,
  "reasoning": "brief_explanation"
}`;

    try {
      const response = await this.openAIService.getAnswer(
        this.getJsonPrompt(content.split(/\s+/).slice(0, 100).join(" "), format)
      );
      return JSON.parse(response) as ContentValidation;
    } catch (error) {
      console.error("Failed to parse content validation response:", error);
      return {
        isValid: false,
        confidence: 0,
        reasoning: "Failed to validate content",
      };
    }
  }

  private async cleanAndChunkContent(html: string): Promise<string> {
    // First remove HTML comments
    const noComments = html.replace(/<!--[\s\S]*?-->/g, "");

    const dom = new JSDOM(noComments);
    const document = dom.window.document;

    // Remove unwanted elements
    ["script", "style", "noscript", "iframe"].forEach((tag) => {
      document.querySelectorAll(tag).forEach((el) => el.remove());
    });

    // Remove hidden elements
    document
      .querySelectorAll(
        '[hidden], .hidden, [style*="display: none"], [style*="display:none"]'
      )
      .forEach((el) => el.remove());

    return document.body.textContent?.trim() || "";
  }

  private async processContent(
    html: string,
    parentChunkId: string,
    questionId: string,
    extractUrls: boolean = true
  ): Promise<ContentChunk[]> {
    const cleanContent = await this.cleanAndChunkContent(html);
    const rawChunks = cleanContent.match(/[^\.!\?]+[\.!\?]+/g) || [];

    let currentChunk = "";
    const chunks: ContentChunk[] = [];
    let chunkId = 0;

    for (const sentence of rawChunks) {
      if ((currentChunk + sentence).length > 1000) {
        chunks.push({
          id: `chunk_${parentChunkId}_${chunkId++}`,
          content: currentChunk.trim(),
          urls: [],
          parentChunkId,
        });
        currentChunk = sentence;
      } else {
        currentChunk += " " + sentence;
      }
    }

    if (currentChunk) {
      chunks.push({
        id: `chunk_${parentChunkId}_${chunkId}`,
        content: currentChunk.trim(),
        urls: [],
        parentChunkId,
      });
    }

    if (extractUrls) {
      const urls = await this.extractAndScoreUrls(
        html,
        parentChunkId,
        questionId
      );
      chunks.forEach((chunk) => {
        chunk.urls = urls;
      });
    } else {
      chunks.forEach((chunk) => {
        chunk.urls = [];
      });
    }

    await Promise.all(
      chunks.map(async (chunk) => {
        chunk.embedding = await this.openAIService.createEmbedding(
          chunk.content
        );
        this.state.contentCache.set(chunk.id, chunk);
      })
    );

    return chunks;
  }

  private async extractAndScoreUrls(
    content: string,
    chunkId: string,
    questionId: string
  ): Promise<URLNode[]> {
    const dom = new JSDOM(content);
    const links = dom.window.document.querySelectorAll("a");
    const urls: URLNode[] = [];

    // First collect all URL metadata
    const urlsToScore = Array.from(links)
      .map((link) => {
        const href = link.getAttribute("href");
        if (!href) return null;

        const url = href.startsWith("http")
          ? href
          : href.startsWith("/")
          ? `${this.BASE_URL}${href}`
          : `${this.BASE_URL}/${href}`;

        return {
          url,
          text: link.textContent?.trim() ?? "",
          title: link.getAttribute("title") || undefined,
          context: link.parentElement?.textContent?.trim() ?? "",
        };
      })
      .filter((meta): meta is NonNullable<typeof meta> => meta !== null);

    // Score all URLs in one batch
    const prompt = `Analyze these URLs for answering this question:
${this.questions[questionId]}

URLs to analyze:
${urlsToScore
  .map(
    (meta, i) => `
URL ${i + 1}:
- URL: ${meta.url}
- Link text: ${meta.text}
- Title: ${meta.title || "none"}
- Context: ${meta.context}
`
  )
  .join("\n")}

Score each URL's relevance (0-1) for answering the question. Compare URLs to each other.

RESPOND WITH RAW JSON ONLY. NO BACKTICKS. NO FORMATTING. EXAMPLE:
{"scores":[{"url":"https://example.com/page1","relevanceScore":0.8,"reasoning":"explanation"}]}

YOUR RESPONSE:`;

    try {
      const response = await this.openAIService.getAnswer(prompt);
      const result = JSON.parse(response) as {
        scores: Array<{
          url: string;
          relevanceScore: number;
          reasoning: string;
        }>;
      };

      // Add scored URLs to the result
      result.scores
        .filter((score) => score.relevanceScore > 0.3)
        .forEach((score) => {
          try {
            // Validate URL
            new URL(score.url);
            urls.push({
              id: `url_${chunkId}_${urls.length}`,
              url: score.url,
              relevanceScore: score.relevanceScore,
              questionIds: [questionId],
              parentChunkId: chunkId,
              visited: false,
              confidence: 0,
            });
          } catch (error) {
            console.log(`Invalid URL skipped: ${score.url}`);
          }
        });

      return urls;
    } catch (error) {
      console.log("Error scoring URLs:", error);
      return [];
    }
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    const dotProduct = a.reduce((sum, val, i) => sum + val * b[i], 0);
    const magnitudeA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
    const magnitudeB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
    return dotProduct / (magnitudeA * magnitudeB);
  }

  private async findSimilarChunks(
    content: string,
    threshold = 0.8
  ): Promise<ContentChunk[]> {
    const queryEmbedding = await this.openAIService.createEmbedding(content);
    const similarChunks: ContentChunk[] = [];

    for (const chunk of this.state.contentCache.values()) {
      if (chunk.embedding) {
        const similarity = this.cosineSimilarity(
          queryEmbedding,
          chunk.embedding
        );
        if (similarity > threshold) {
          similarChunks.push(chunk);
        }
      }
    }

    return similarChunks;
  }

  private log(action: Action): void {
    const timestamp = new Date().toISOString();
    const stepInfo = Object.entries(this.stepCounts)
      .map(([qId, count]) => `Q${qId}: ${count}/${this.MAX_STEPS}`)
      .join(", ");

    const logEntry = {
      timestamp,
      action,
      stepCounts: stepInfo,
      queueSize: this.state.urlQueue["items"].length,
      visitedUrls: this.state.visitedUrls.size,
      cachedChunks: this.state.contentCache.size,
      foundAnswers: Array.from(this.state.answers.entries()).map(
        ([qId, a]) => `Q${qId}(${(a.confidence * 100).toFixed(1)}%)`
      ),
    };

    this.debugLog.push(JSON.stringify(logEntry, null, 2));
    console.log(`[${timestamp}] ${action.type}:`, action);
  }

  private async exploreUrl(url: string, questionId: string): Promise<void> {
    this.log({ type: "VISIT", url });

    if (this.state.visitedUrls.has(url)) {
      this.log({ type: "YIELD", reason: "URL already visited", url });
      return;
    }

    try {
      this.state.visitedUrls.add(url);
      this.log({ type: "SCRAPE", url });
      const response = await axios.get<string>(url);

      this.log({
        type: "PARSE",
        content: `Fetched content length: ${response.data.length}`,
        url,
      });

      // First process content without URLs
      const chunks = await this.processContent(
        response.data,
        url,
        questionId,
        false
      );

      // Check content for answers first
      for (const chunk of chunks) {
        const validation = await this.validateContent(chunk.content);
        if (validation.isValid) {
          await this.analyzeChunkForAnswers(chunk, questionId);

          // If we found a high-confidence answer, stop here
          const answer = this.state.answers.get(questionId);
          if (answer && answer.confidence > 0.8) {
            return;
          }
        }
      }

      // Only extract and score URLs if we haven't found a good answer
      const urls = await this.extractAndScoreUrls(
        response.data,
        url,
        questionId
      );

      // Add URLs to chunks and queue
      chunks.forEach((chunk) => {
        chunk.urls = urls;
      });

      urls.forEach((urlNode) => {
        if (!this.state.visitedUrls.has(urlNode.url)) {
          this.state.urlQueue.enqueue(urlNode);
        }
      });
    } catch (error) {
      this.log({
        type: "YIELD",
        reason: `Error exploring URL ${url}: ${error}`,
      });
    }
  }

  private async analyzeChunkForAnswers(
    chunk: ContentChunk,
    questionId: string
  ): Promise<void> {
    const format = `{
      "answer": {
        "found": boolean,
        "content": "string_or_empty",
        "confidence": number_between_0_and_1,
        "foundInUrl": "string_or_empty",
        "reasoning": "explanation of why this is or isn't an answer"
      }
    }`;

    try {
      const similarChunks = await this.findSimilarChunks(chunk.content);
      const relevantUrls = chunk.urls
        .filter(
          (u) => u.questionIds.includes(questionId) && u.relevanceScore > 0.7
        )
        .map((u) => {
          const metadata = this.urlMetadataCache.get(u.url);
          return `URL: ${u.url}
Link text: ${metadata?.text || ""}
Context: ${metadata?.context || ""}`;
        })
        .join("\n\n");

      const content = `Primary content:
${chunk.content}

Related context:
${similarChunks.map((c) => c.content).join("\n---\n")}

Found relevant URLs:
${relevantUrls}

IMPORTANT:
1. Only return an answer if it's explicitly found in the content or URLs above
2. Do not make assumptions or generate answers
3. If no clear answer is found, set found=false
4. An URL found in the text might also be an answer, but it's not guaranteed. Check URLs' metadata for more context.

Question:
${this.questions[questionId]}`;

      const response = await this.openAIService.getAnswer(
        this.getJsonPrompt(content, format)
      );
      const result = JSON.parse(response);

      if (result.answer.found && result.answer.confidence > 0.8) {
        const finalContent = result.answer.foundInUrl || result.answer.content;

        const answer = {
          questionId,
          content: finalContent,
          confidence: result.answer.confidence,
          sourcePath: [chunk.id, ...similarChunks.map((c) => c.id)],
        };

        this.log({
          type: "ANSWER",
          answer: {
            ...answer,
            preview: answer.content.substring(0, 100),
            reasoning: result.answer.reasoning,
          },
        });

        this.state.answers.set(questionId, answer);
      } else {
        this.log({
          type: "REASON",
          context:
            result.answer.reasoning || "No valid answer found in content",
        });
      }
    } catch (error) {
      this.log({
        type: "YIELD",
        reason: `Error analyzing chunk ${chunk.id}: ${error}`,
      });
    }
  }

  private async exploreForQuestion(questionId: string): Promise<Answer | null> {
    console.log(
      `Starting exploration for question ${questionId}: ${this.questions[questionId]}`
    );

    // Start with homepage
    await this.exploreUrl(this.BASE_URL, questionId);

    let exploredCount = 0;
    while (!this.state.urlQueue.isEmpty() && exploredCount < 10) {
      const nextUrl = this.state.urlQueue.dequeue();
      if (!nextUrl) continue;

      console.log(
        `Exploring URL ${++exploredCount} for Q${questionId}:`,
        nextUrl.url
      );
      await this.exploreUrl(nextUrl.url, questionId);

      // Check if we found answer with good confidence
      const answer = this.state.answers.get(questionId);
      if (answer && answer.confidence > 0.8) {
        return answer;
      }
    }

    return null;
  }

  async explore(): Promise<{ [key: string]: string }> {
    const rawAnswers = new Map<string, Answer>();

    // Process questions one by one
    for (const questionId of Object.keys(this.questions)) {
      // Reset state for new question
      this.state.visitedUrls.clear();
      this.state.urlQueue = new PriorityQueue();
      this.state.contentCache.clear();
      this.state.answers.clear();

      const answer = await this.exploreForQuestion(questionId);
      if (answer) {
        rawAnswers.set(questionId, answer);
      }
    }

    // Format answers for verification
    return Object.fromEntries(
      Array.from(rawAnswers.entries()).map(([id, answer]) => [
        id,
        answer.content,
      ])
    );
  }
}

export async function runWebScrapper() {
  const questions = {
    "01": "Podaj adres mailowy do firmy SoftoAI",
    "02": "Jaki jest adres interfejsu webowego do sterowania robotami zrealizowanego dla klienta jakim jest firma BanAN?",
    "03": "Jakie dwa certyfikaty jakości ISO otrzymała firma SoftoAI?",
  };

  const scraper = new WebScraper(questions, new OpenAIService());

  try {
    // Start exploration and get answers
    const answers = await scraper.explore();

    console.log("Found answers:", answers);

    const verifyResponse = await axios.post(
      "https://centrala.ag3nts.org/report",
      {
        task: "softo",
        apikey: process.env.API_KEY,
        answer: answers,
      }
    );
    console.log("Found answers:", verifyResponse.data);
  } catch (error) {
    console.error("Error in web scraper:", error);
  }
}
