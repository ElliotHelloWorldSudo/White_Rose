import fs from 'fs';
import path from 'path';
import { Configuration, OpenAIApi } from 'openai';
import mammoth from 'mammoth';
import mm from 'music-metadata';
import sharp from 'sharp';
import crypto from 'crypto';

const CONVERSATIONS_FILE = path.join(process.cwd(), 'conversations.json');

// Helper to load/save conversation state
function loadConversations() {
  try {
    return JSON.parse(fs.readFileSync(CONVERSATIONS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveConversations(data) {
  fs.writeFileSync(CONVERSATIONS_FILE, JSON.stringify(data, null, 2));
}

function generateFileId(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

export default class AIWrapper {
  constructor() {
    const configuration = new Configuration({
      apiKey: process.env.OPENAI_API_KEY,
    });
    this.client = new OpenAIApi(configuration);
  }

  async extractTextFromDocx(buffer) {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  async extractMusicMetadata(buffer) {
    try {
      const metadata = await mm.parseBuffer(buffer, 'audio/mpeg', { duration: true });
      const title = metadata.common.title || null;
      const artist = metadata.common.artist || null;
      const album = metadata.common.album || null;
      const duration = Math.round(metadata.format.duration);
      const hasMetadata = title || artist || album ? true : false;
      return {
        hasMetadata,
        description: hasMetadata
          ? `Title: ${title || 'unknown'}, Artist: ${artist || 'Unknown'}, Album: ${album || 'Unknown'}, Duration: ${duration}s`
          : null,
      };
    } catch {
      return { hasMetadata: false, description: null };
    }
  }

  async extractArtMetadata(buffer) {
    try {
      const image = sharp(buffer);
      const metadata = await image.metadata();
      const hasMetadata = metadata.exif ? true : false;
      return { hasMetadata, description: hasMetadata ? 'Image metadata available' : null };
    } catch {
      return { hasMetadata: false, description: null };
    }
  }

  async extractWritingMetadata(buffer) {
    try {
      await mammoth.extractRawText({ buffer });
      return { hasMetadata: false, description: null };
    } catch {
      return { hasMetadata: false, description: null };
    }
  }

  async generateCritique(type, fileBuffer, bluntness) {
    let contentDescription = '';
    let metadataDescription = '';
    let metadataExists = false;

    switch (type) {
      case 'writing':
        contentDescription = await this.extractTextFromDocx(fileBuffer);
        ({ hasMetadata: metadataExists, description: metadataDescription } = await this.extractWritingMetadata(fileBuffer));
        break;
      case 'art':
        contentDescription =
          'An uploaded image file to be critiqued from a technical standpoint for composition, color, tone and technique';
        ({ hasMetadata: metadataExists, description: metadataDescription } = await this.extractArtMetadata(fileBuffer));
        break;
      case 'music':
        contentDescription =
          'An uploaded audio file to be critiqued from a technical standpoint for melody, rhythm, harmony, beats and originality.';
        ({ hasMetadata: metadataExists, description: metadataDescription } = await this.extractMusicMetadata(fileBuffer));
        break;
      default:
        throw new Error('Invalid type. Must be music, art or writing.');
    }

    let prompt = `
You are a professional artist, musician and writer with decades of experience and are expert at each of these, and you are very witty.
Mode: ${type}
Bluntness Meter: ${bluntness}/10
Content (90% weight):
${contentDescription}
`;

    if (metadataExists && metadataDescription) {
      prompt += `
Metadata (10% weight):
${metadataDescription}
`;
    }

    prompt += `
Provide feedback divided into three sections in JSON format:
1. Expert's Advice
2. Intermediate Gaps
3. Rookie Concepts
Be witty but balanced, don't overdo jokes.
Make sure to give medium-length feedback, 3 sentences per section
`;

    const systemPrompt = `
You are a witty, professional critic across music, art, and writing.
You balance humor with deep technical insight. Always follow JSON format.
`;

    const response = await this.client.chat.completions.create({
      model: 'gpt-4',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
      max_tokens: 450,
    });

    const aiText = response.choices[0].message.content;

    const expertMatch = aiText.match(/Expert's Advice\s*:\s*(.*?)(?=Intermediate Gaps\s*:|$)/s);
    const intermediateMatch = aiText.match(/Intermediate Gaps\s*:\s*(.*?)(?=Rookie Concepts\s*:|$)/s);
    const rookieMatch = aiText.match(/Rookie Concepts\s*:\s*(.*)/s);

    return {
      expertAdvice: expertMatch ? expertMatch[1].trim() : '',
      intermediateGaps: intermediateMatch ? intermediateMatch[1].trim() : '',
      rookieConcepts: rookieMatch ? rookieMatch[1].trim() : '',
    };
  }

  async generateCritiqueWithContext(type, fileBuffer, bluntness, followUpQuestion = null) {
    const fileId = generateFileId(fileBuffer);
    const conversations = loadConversations();

    if (!conversations[fileId]) {
      const initialCritique = await this.generateCritique(type, fileBuffer, bluntness);
      conversations[fileId] = [
        { role: 'system', content: 'You are a witty and balanced creative critic.' },
        { role: 'user', content: 'Initial critique request' },
        { role: 'assistant', content: JSON.stringify(initialCritique) },
      ];
      saveConversations(conversations);
      return { fileId, initialCritique };
    }

    if (followUpQuestion) {
      conversations[fileId].push({ role: 'user', content: followUpQuestion });

      const response = await this.client.chat.completions.create({
        model: 'gpt-4',
        messages: conversations[fileId],
        max_tokens: 600,
      });

      const followUpReply = response.choices[0].message.content;
      conversations[fileId].push({ role: 'assistant', content: followUpReply });

      saveConversations(conversations);
      return { fileId, followUpReply };
    }

    return { fileId, initialCritique: JSON.parse(conversations[fileId][2].content) };
  }
}
