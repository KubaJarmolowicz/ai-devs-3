import axios from "axios";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { OpenAIService } from "../services/OpenAIService";

dotenv.config();

const PEOPLE_API_URL = "https://centrala.ag3nts.org/people";
const PLACES_API_URL = "https://centrala.ag3nts.org/places";

const NAME_TO_FIND = "BARBARA";

interface Person {
  name: string;
  wasFoundIn: string[];
  wasQueried: boolean;
}

interface Place {
  name: string;
  wasVisitedBy: string[];
  wasQueried: boolean;
}

const normalizeText = (text: string): string => {
  return text
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[ĄĘŁŃÓŚŹŻąęłńóśźż]/g, (char) => {
      const map: Record<string, string> = {
        Ą: "A",
        Ę: "E",
        Ł: "L",
        Ń: "N",
        Ó: "O",
        Ś: "S",
        Ź: "Z",
        Ż: "Z",
        ą: "A",
        ę: "E",
        ł: "L",
        ń: "N",
        ó: "O",
        ś: "S",
        ź: "Z",
        ż: "Z",
      };
      return map[char] || char;
    });
};

const shouldConcludeRetrieval = (
  people: Person[],
  places: Place[]
): boolean => {
  return people.every((p) => p.wasQueried) && places.every((p) => p.wasQueried);
};

const processApiResponse = async (
  query: string,
  apiUrl: string,
  people: Person[],
  places: Place[],
  isPersonQuery: boolean
) => {
  const response = await axios.post<{ message: string }>(apiUrl, {
    apikey: process.env.API_KEY,
    query,
  });

  if (response.data.message.includes("RESTRICTED DATA")) {
    return;
  }

  if (response.data.message.includes("https")) {
    return;
  }

  const items = response.data.message.split(" ").map(normalizeText);

  if (isPersonQuery) {
    const person = people.find((p) => p.name === query)!;
    person.wasFoundIn = items;

    // Add new places
    for (const placeName of items) {
      if (!places.some((p) => p.name === placeName)) {
        places.push({
          name: placeName,
          wasVisitedBy: [query],
          wasQueried: false,
        });
      } else {
        const place = places.find((p) => p.name === placeName)!;
        if (!place.wasVisitedBy.includes(query)) {
          place.wasVisitedBy.push(query);
        }
      }
    }
  } else {
    const place = places.find((p) => p.name === query)!;
    place.wasVisitedBy = items;

    // Add new people
    for (const personName of items) {
      if (!people.some((p) => p.name === personName)) {
        people.push({
          name: personName,
          wasFoundIn: [query],
          wasQueried: false,
        });
      } else {
        const person = people.find((p) => p.name === personName)!;
        if (!person.wasFoundIn.includes(query)) {
          person.wasFoundIn.push(query);
        }
      }
    }
  }
};

const retrievePeopleAndPlaces = async (
  people: Person[],
  places: Place[],
  recursionCount: number = 0
): Promise<{ people: Person[]; places: Place[] }> => {
  if (recursionCount > 25) {
    throw new Error(
      "Max recursion depth reached (25) - possible infinite loop"
    );
  }

  if (
    shouldConcludeRetrieval(people, places) &&
    people.every((p) => p.wasQueried) &&
    places.every((p) => p.wasQueried)
  ) {
    return { people, places };
  }

  // Process all unqueried people
  for (const person of people.filter((p) => !p.wasQueried)) {
    await processApiResponse(person.name, PEOPLE_API_URL, people, places, true);
    person.wasQueried = true;
  }

  // Process all unqueried places
  for (const place of places.filter((p) => !p.wasQueried)) {
    await processApiResponse(place.name, PLACES_API_URL, people, places, false);
    place.wasQueried = true;
  }

  return retrievePeopleAndPlaces(people, places, recursionCount + 1);
};

export async function runLoop() {
  const openaiService = new OpenAIService();

  try {
    const noteContent = fs.readFileSync(
      path.join(__dirname, "..", "resources", "barbara.txt"),
      "utf8"
    );

    const extractNamesPrompt = `You are a person name extractor. Extract all first names from the given text.
IMPORTANT:
- Return only first names as comma-separated values, nothing else
- Convert all names to nominative case (mianownik)
- Convert all Polish characters to English
  Example: "ł" -> "l", "ą" -> "a", "ś" -> "s"
  Example: "Grześka" -> "Grzesiek", "Basię" -> "Basia", "Tomka" -> "Tomek"
- Names must be in Polish`;
    const names = (
      await openaiService.getAnswer(extractNamesPrompt, noteContent)
    )
      .split(",")
      .map((person) => person.trim());

    const { people, places } = await retrievePeopleAndPlaces(
      names.map((name) => ({
        name: normalizeText(name),
        wasFoundIn: [],
        wasQueried: false,
      })),
      []
    );

    const missingPersonData = people.find((p) => p.name === NAME_TO_FIND);
    const missingPersonPlaces = missingPersonData?.wasFoundIn;

    const question = `Today is 18.01.2025.
    Here's some historical context: ${noteContent}. Pay attention to the dates. Here's the list of places where ${NAME_TO_FIND} was found at some point in time:
    <places>
    ${missingPersonPlaces?.join(", ")}.
    </places>
    If any of these places are mentioned in the historical context and yet their status is still missing, it is likely that ${NAME_TO_FIND} is not there anymore.
    I need you to return to me the name of the place where ${NAME_TO_FIND} is most likely to be found.
    IMPORTANT:
    - Return only the name of the place, nothing else
    - DO NOT MODIFY THE NAME OF THE PLACE
    `;

    const answer = await openaiService.getAnswer(question);

    // Report the answer
    const verifyResponse = await axios.post(
      "https://centrala.ag3nts.org/report",
      {
        task: "loop",
        apikey: process.env.API_KEY,
        answer,
      }
    );

    console.log("Verification:", verifyResponse.data);
  } catch (error) {
    console.error("Error in loop task:", (error as any).response?.data);
    console.error("Request:", (error as any)?.config?.data);
  }
}
