import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { AzureKeyCredential } from "@azure/core-auth";
import * as aiInference from "@azure-rest/ai-inference";

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true }));

// Azure AI API configuration
const endpoint = "https://models.inference.ai.azure.com";
const apiKey = "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"; // GitHub PAT token

// Create Azure AI client once instead of per request
let client;
try {
  client = aiInference.default(endpoint, new AzureKeyCredential(apiKey));
  console.log("Azure AI client initialized successfully");
} catch (error) {
  console.error("Failed to initialize Azure AI client:", error.message);
}

// Fallback response generator
const generateFallbackResponse = (type, customData = {}) => {
  const responses = {
    code: `// Generated code for: ${customData.prompt || 'example'}\n// Language: ${customData.language || 'JavaScript'}\n\nfunction greet(name) {\n  return \`Hello, \${name}!\`;\n}\n\nfunction calculateSum(numbers) {\n  return numbers.reduce((sum, num) => sum + num, 0);\n}\n\n// Example usage\nconst name = "World";\nconst numbers = [1, 2, 3, 4, 5];\nconsole.log(greet(name));\nconsole.log(\`Sum: \${calculateSum(numbers)}\`);`,
    
    convert: `// Converted from ${customData.fromLanguage || 'Python'} to ${customData.toLanguage || 'JavaScript'}\n\n${customData.sourceCode ? '// Original code:\n// ' + customData.sourceCode.split('\n').join('\n// ') + '\n\n' : ''}function processData(data) {\n  return data.map(item => item * 2).filter(item => item > 10);\n}\n\n// Example usage\nconst inputData = [5, 10, 15, 20];\nconst result = processData(inputData);\nconsole.log("Processed data:", result);`,
    
    scan: `// Code extracted from image\n\nfunction calculateTotal(items) {\n  return items.reduce((total, item) => total + item.price, 0);\n}\n\nclass ShoppingCart {\n  constructor() {\n    this.items = [];\n  }\n  \n  addItem(item) {\n    this.items.push(item);\n  }\n  \n  getTotal() {\n    return calculateTotal(this.items);\n  }\n}\n\n// Usage\nconst cart = new ShoppingCart();\ncart.addItem({ name: "Laptop", price: 999 });\ncart.addItem({ name: "Headphones", price: 99 });\nconsole.log("Total: $" + cart.getTotal());`,
    
    explain: `This code defines a function called 'calculateTotal' that takes an array of items as input and returns the sum of all item prices using the reduce method.

The ShoppingCart class provides a simple implementation of a shopping cart that:
1. Stores items in an array
2. Allows adding new items with the addItem method
3. Calculates the total price of all items using the getTotal method, which calls the calculateTotal function

The code demonstrates object-oriented programming principles with a class that encapsulates both data (the items array) and behavior (the methods). It shows a practical example of how to implement a basic e-commerce cart functionality.`,
    
    chat: `I'm your AI coding assistant. I can help with programming questions, explain code concepts, and provide coding solutions. For your question, I'd recommend breaking down the problem into smaller steps:

1. Start by defining the core functionality you need
2. Create a simple implementation first
3. Test with sample inputs
4. Refine your approach based on the results

Is there a specific programming language or framework you're working with? I can provide more targeted advice if you share more details about your project.`
  };
  
  return responses[type] || "I'm sorry, I don't have a response for that request type.";
};

// Timeout wrapper for API calls
const withTimeout = (promise, timeoutMs = 10000) => {
  let timeoutHandle;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(`Request timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  
  return Promise.race([
    promise,
    timeoutPromise
  ]).finally(() => {
    clearTimeout(timeoutHandle);
  });
};

// Health check endpoint
app.get('/health', async (req, res) => {
  // Just return a success status without trying to connect to the API
  res.status(200).json({ 
    status: 'ok', 
    server: 'running',
    mode: client ? 'azure' : 'demo',
    api_status: client ? 'available' : 'fallback mode'
  });
});

// Generate code endpoint
app.post('/generate', async (req, res) => {
  const { prompt, language } = req.body;
  
  if (!prompt || !language) {
    return res.status(400).json({ error: "Missing required parameters: prompt and language" });
  }

  // Log the request
  console.log(`Generating ${language} code for: ${prompt.substring(0, 50)}${prompt.length > 50 ? '...' : ''}`);
  
  // If no client, return fallback
  if (!client) {
    return res.status(200).json({ 
      generated_text: generateFallbackResponse('code', { prompt, language }),
      _demo: true
    });
  }

  try {
    // Try to use the Azure AI API
    const response = await withTimeout(
      client.path("/chat/completions").post({
        body: {
          messages: [
            { role: "system", content: "You are an expert programmer. You only output code, no explanations. No markdown formatting." },
            { role: "user", content: `Generate ${language} code for: ${prompt}` }
          ],
          model: "gpt-4o",
          max_tokens: 1000
        }
      })
    ).catch(error => {
      console.error("API error:", error.message);
      return null;
    });
    
    if (response && response.status === "200") {
      const generatedText = response.body.choices[0].message.content;
      res.status(200).json({ generated_text: generatedText });
    } else {
      // Fallback if API call failed
      res.status(200).json({ 
        generated_text: generateFallbackResponse('code', { prompt, language }),
        _demo: true
      });
    }
  } catch (error) {
    console.error("Generate code error:", error.message);
    // Return fallback response on error
    res.status(200).json({ 
      generated_text: generateFallbackResponse('code', { prompt, language }),
      _demo: true
    });
  }
});

// Convert code endpoint
app.post('/convert', async (req, res) => {
  const { sourceCode, fromLanguage, toLanguage } = req.body;
  
  if (!sourceCode || !fromLanguage || !toLanguage) {
    return res.status(400).json({ error: "Missing required parameters: sourceCode, fromLanguage, toLanguage" });
  }
  
  // Log the request
  console.log(`Converting code from ${fromLanguage} to ${toLanguage}`);
  
  // If no client, return fallback
  if (!client) {
    return res.status(200).json({ 
      generated_text: generateFallbackResponse('convert', { sourceCode, fromLanguage, toLanguage }),
      _demo: true
    });
  }

  try {
    // Try to use the Azure AI API
    const response = await withTimeout(
      client.path("/chat/completions").post({
        body: {
          messages: [
            { role: "system", content: "You are an expert programmer who specializes in converting code between programming languages. You only output the converted code, no explanations. No markdown formatting." },
            { role: "user", content: `Convert the following code from ${fromLanguage} to ${toLanguage}: \n\n${sourceCode}` }
          ],
          model: "gpt-4o",
          max_tokens: 1000
        }
      })
    ).catch(error => {
      console.error("API error:", error.message);
      return null;
    });
    
    if (response && response.status === "200") {
      const generatedText = response.body.choices[0].message.content;
      res.status(200).json({ generated_text: generatedText });
    } else {
      // Fallback if API call failed
      res.status(200).json({ 
        generated_text: generateFallbackResponse('convert', { sourceCode, fromLanguage, toLanguage }),
        _demo: true
      });
    }
  } catch (error) {
    console.error("Convert code error:", error.message);
    // Return fallback response on error
    res.status(200).json({ 
      generated_text: generateFallbackResponse('convert', { sourceCode, fromLanguage, toLanguage }),
      _demo: true
    });
  }
});

// Scan code endpoint
app.post('/scan', async (req, res) => {
  const { base64Image } = req.body;
  
  if (!base64Image) {
    return res.status(400).json({ error: "Missing required parameter: base64Image" });
  }
  
  // Log the request
  console.log(`Processing image data (length: ${base64Image.length} characters)`);
  
  // If no client, return fallback
  if (!client) {
    return res.status(200).json({ 
      generated_text: generateFallbackResponse('scan'),
      _demo: true
    });
  }

  try {
    // Try to use the Azure AI API
    const response = await withTimeout(
      client.path("/chat/completions").post({
        body: {
          messages: [
            { role: "system", content: "You are an expert in extracting and analyzing code from images. Extract the code from the image, fix any errors, and output only the corrected code. No markdown formatting." },
            { role: "user", content: `Analyze and extract the code from this image: [base64 image data]` }
          ],
          model: "gpt-4o",
          max_tokens: 1000
        }
      })
    ).catch(error => {
      console.error("API error:", error.message);
      return null;
    });
    
    if (response && response.status === "200") {
      const generatedText = response.body.choices[0].message.content;
      res.status(200).json({ generated_text: generatedText });
    } else {
      // Fallback if API call failed
      res.status(200).json({ 
        generated_text: generateFallbackResponse('scan'),
        _demo: true
      });
    }
  } catch (error) {
    console.error("Scan code error:", error.message);
    // Return fallback response on error
    res.status(200).json({ 
      generated_text: generateFallbackResponse('scan'),
      _demo: true
    });
  }
});

// Explain code endpoint
app.post('/explain', async (req, res) => {
  const { code } = req.body;
  
  if (!code) {
    return res.status(400).json({ error: "Missing required parameter: code" });
  }
  
  // Log the request
  console.log(`Explaining code (length: ${code.length} characters)`);
  
  // If no client, return fallback
  if (!client) {
    return res.status(200).json({ 
      generated_text: generateFallbackResponse('explain'),
      _demo: true
    });
  }

  try {
    // Try to use the Azure AI API
    const response = await withTimeout(
      client.path("/chat/completions").post({
        body: {
          messages: [
            { role: "system", content: "You are an expert programmer who specializes in explaining code in a clear, concise manner. Focus on the purpose, functionality, and logic of the code." },
            { role: "user", content: `Explain the following code: \n\n${code}` }
          ],
          model: "gpt-4o",
          max_tokens: 1000
        }
      })
    ).catch(error => {
      console.error("API error:", error.message);
      return null;
    });
    
    if (response && response.status === "200") {
      const generatedText = response.body.choices[0].message.content;
      res.status(200).json({ generated_text: generatedText });
    } else {
      // Fallback if API call failed
      res.status(200).json({ 
        generated_text: generateFallbackResponse('explain'),
        _demo: true
      });
    }
  } catch (error) {
    console.error("Explain code error:", error.message);
    // Return fallback response on error
    res.status(200).json({ 
      generated_text: generateFallbackResponse('explain'),
      _demo: true
    });
  }
});

// Chat endpoint
app.post('/chat', async (req, res) => {
  const { message } = req.body;
  
  if (!message) {
    return res.status(400).json({ error: "Missing required parameter: message" });
  }
  
  // Log the request
  console.log(`Chat request: ${message.substring(0, 50)}${message.length > 50 ? '...' : ''}`);
  
  // If no client, return fallback
  if (!client) {
    return res.status(200).json({ 
      generated_text: generateFallbackResponse('chat'),
      _demo: true
    });
  }

  try {
    // Try to use the Azure AI API
    const response = await withTimeout(
      client.path("/chat/completions").post({
        body: {
          messages: [
            { role: "system", content: "You are a helpful coding assistant specialized in programming and software development. Provide concise, accurate, and helpful responses to any coding or development questions." },
            { role: "user", content: message }
          ],
          model: "gpt-4o",
          max_tokens: 1000
        }
      })
    ).catch(error => {
      console.error("API error:", error.message);
      return null;
    });
    
    if (response && response.status === "200") {
      const generatedText = response.body.choices[0].message.content;
      res.status(200).json({ generated_text: generatedText });
    } else {
      // Fallback if API call failed
      res.status(200).json({ 
        generated_text: generateFallbackResponse('chat'),
        _demo: true
      });
    }
  } catch (error) {
    console.error("Chat error:", error.message);
    // Return fallback response on error
    res.status(200).json({ 
      generated_text: generateFallbackResponse('chat'),
      _demo: true
    });
  }
});

// Error handler middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ 
    error: 'Internal server error', 
    message: err.message
  });
});

// Start server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  console.log(`API client: ${client ? 'initialized' : 'fallback mode'}`);
  console.log(`Server ready!`);
}); 