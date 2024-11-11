import puppeteer from "puppeteer";
import axios from "axios";
import { OpenAIService } from "../services/OpenAIService";

export async function runXYZChallenge() {
  try {
    // 1. Scrape the question and form details
    const browser = await puppeteer.launch({
      headless: true,
    });
    const page = await browser.newPage();
    await page.goto("https://xyz.ag3nts.org/");

    const formData = await page.evaluate(() => {
      const form = document.querySelector("form");
      if (!form) return null;
      return {
        action: form.action,
        method: form.method,
        inputs: Array.from(form.querySelectorAll("input")).map((input) => ({
          name: input.name,
          type: input.type,
          value: input.value,
        })),
      };
    });

    const question = await page.$eval(
      "#human-question",
      (el: Element) => el.textContent
    );
    await browser.close();

    if (!question) throw new Error("Question not found");
    if (!formData) throw new Error("Form data not found");

    // 2. Get LLM answer
    const openAIService = new OpenAIService();
    const answer = await openAIService.getAnswer(
      question,
      "You must respond ONLY with a single numerical value. No other characters, words, or explanations. Just the number."
    );

    console.log("Question:", question);
    console.log("Answer:", answer);

    // 3. Send POST request as form data
    const form = new FormData();
    form.append("answer", answer);
    formData.inputs.forEach((input) => {
      if (input.name === "username")
        form.append(input.name, process.env.XYZ_USERNAME || "");
      else if (input.name === "password")
        form.append(input.name, process.env.XYZ_PASSWORD || "");
      else if (input.value) form.append(input.name, input.value);
    });

    const response = await axios.post(formData.action, form, {
      headers: {
        "Content-Type": "multipart/form-data",
      },
    });

    // 4. Log the URL
    console.log("Server response:", response.data);
  } catch (error) {
    console.error("Error:", error);
  }
}
