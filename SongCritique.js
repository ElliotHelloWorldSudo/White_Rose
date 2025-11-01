import AIWrapper from './AIWrapper.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { fileBufferBase64, bluntness = 5, followUpQuestion } = req.body;

    if (!fileBufferBase64) {
      return res.status(400).json({ error: 'fileBufferBase64 is required' });
    }

    const fileBuffer = Buffer.from(fileBufferBase64, 'base64');
    const ai = new AIWrapper();

    const result = await ai.generateCritiqueWithContext(
      'music',
      fileBuffer,
      bluntness,
      followUpQuestion
    );

    return res.status(200).json(result);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}
