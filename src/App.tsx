import React, { useState, useCallback, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import { 
  Upload, 
  Camera, 
  Image as ImageIcon, 
  Video, 
  CheckCircle2, 
  Loader2, 
  AlertCircle,
  Maximize2,
  ChevronRight,
  Download,
  Key,
  RotateCcw,
  X,
  Plus
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI, Modality, ThinkingLevel } from "@google/genai";
import { cn } from './lib/utils';

// --- Types ---
interface GeneratedItem {
  id: string;
  title: string;
  description: string;
  type: 'image' | 'video';
  status: 'pending' | 'processing' | 'completed' | 'error';
  url?: string;
  prompt: string;
}

declare global {
  interface Window {
    aistudio: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}

// --- Constants ---
const MODELS = {
  ANALYSIS: 'gemini-3-flash-preview',
  IMAGE: 'gemini-3.1-flash-image-preview',
  VIDEO: 'veo-3.1-lite-generate-preview',
};

const GENERATION_PLAN: Omit<GeneratedItem, 'id' | 'status'>[] = [
  { title: 'Angle 1', description: 'Professional studio shot from a front-side angle.', type: 'image', prompt: 'Professional studio product photograph of [PRODUCT] from a front-side 45-degree angle, clean white background, soft shadows, studio lighting, high resolution, 4k.' },
  { title: 'Angle 2', description: 'Professional studio shot from a side angle.', type: 'image', prompt: 'Professional studio product photograph of [PRODUCT] from a side profile angle, clean white background, soft shadows, studio lighting, high resolution, 4k.' },
  { title: 'Angle 3', description: 'Professional studio shot from a top-down angle.', type: 'image', prompt: 'Professional studio product photograph of [PRODUCT] from a high top-down angle, clean white background, soft shadows, studio lighting, high resolution, 4k.' },
  { title: 'Closeup 1', description: 'Macro shot showing fine texture and details.', type: 'image', prompt: 'Professional macro closeup photograph of [PRODUCT] showing fine texture and intricate details, clean white background, studio lighting, high resolution.' },
  { title: 'Closeup 2', description: 'Another macro shot focusing on specific features.', type: 'image', prompt: 'Professional macro closeup photograph of [PRODUCT] focusing on its unique features and craftsmanship, clean white background, studio lighting, high resolution.' },
  { title: 'Contrast Shot', description: 'High contrast lighting for a dramatic look.', type: 'image', prompt: 'Professional high-contrast product photograph of [PRODUCT], dramatic studio lighting with deep shadows and bright highlights, clean white background, high resolution.' },
  { title: 'Real Life', description: 'Product in a natural, real-world setting.', type: 'image', prompt: 'A high-quality lifestyle photograph of [PRODUCT] placed in a modern, clean real-life setting with natural lighting, professional photography.' },
  { title: 'In Use', description: 'Product being used in its intended context.', type: 'image', prompt: 'A professional lifestyle photograph of [PRODUCT] being used by a person in its intended context, high quality, natural lighting.' },
  { title: 'Product Video', description: 'A cinematic 360-degree rotation video.', type: 'video', prompt: 'A slow cinematic 360-degree rotation of [PRODUCT] on a clean white background, soft studio lighting, high resolution, smooth motion.' },
  { title: 'Title Photo', description: 'Product placed on a grey circle background.', type: 'image', prompt: 'A professional title photograph of [PRODUCT] placed on a small subtle grey circle on a clean white background. The product is significantly larger than the circle. Soft shadows, studio lighting, high resolution.' },
  { title: 'Dimensions', description: 'Product with clean dimension markings.', type: 'image', prompt: 'A professional product photograph of [PRODUCT] with clean, minimalist dimension lines and text labels showing its size and scale, clean white background, studio lighting.' },
];

// --- Helper for Retries ---
const withRetry = async <T,>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  initialDelay: number = 2000
): Promise<T> => {
  let lastError: any;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (err: any) {
      lastError = err;
      const isRetryable = 
        err.message?.includes("503") || 
        err.message?.includes("high demand") ||
        err.message?.includes("overloaded") ||
        err.status === "UNAVAILABLE" ||
        err.code === 503;

      if (!isRetryable || i === maxRetries - 1) throw err;
      
      const delay = initialDelay * Math.pow(2, i);
      console.warn(`API busy, retrying in ${delay}ms... (Attempt ${i + 1}/${maxRetries})`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw lastError;
};

export default function App() {
  const [uploadedImages, setUploadedImages] = useState<string[]>([]);
  const [productDescription, setProductDescription] = useState<string>('');
  const [items, setItems] = useState<GeneratedItem[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Check for API key on mount
  useEffect(() => {
    const checkKey = async () => {
      if (window.aistudio) {
        const hasKey = await window.aistudio.hasSelectedApiKey();
        setHasApiKey(hasKey);
      }
    };
    checkKey();
  }, []);

  const handleOpenKeyDialog = async () => {
    if (window.aistudio) {
      await window.aistudio.openSelectKey();
      setHasApiKey(true);
    }
  };

  const onDrop = useCallback((acceptedFiles: File[]) => {
    acceptedFiles.forEach(file => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const result = e.target?.result as string;
        setUploadedImages(prev => [...prev, result].slice(0, 5)); // Limit to 5 images
        setError(null);
      };
      reader.readAsDataURL(file);
    });
  }, []);

  const removeImage = (index: number) => {
    setUploadedImages(prev => prev.filter((_, i) => i !== index));
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'image/*': [] },
    multiple: true,
  });

  const startGeneration = async () => {
    if (uploadedImages.length === 0) return;

    // Check for key selection if not already done
    if (window.aistudio) {
      const hasKey = await window.aistudio.hasSelectedApiKey();
      if (!hasKey) {
        await handleOpenKeyDialog();
        // After dialog, we assume key is selected and proceed
      }
    }

    setIsProcessing(true);
    setError(null);
    
    // Initialize items
    const initialItems: GeneratedItem[] = GENERATION_PLAN.map((p, i) => ({
      ...p,
      id: `item-${i}`,
      status: 'pending',
    }));
    setItems(initialItems);

    try {
      // Create AI instance with the most up-to-date key
      // Use API_KEY if available (selected via dialog), otherwise fallback to GEMINI_API_KEY
      const currentApiKey = (process.env.API_KEY || process.env.GEMINI_API_KEY) as string;
      const ai = new GoogleGenAI({ apiKey: currentApiKey });
      
      const imageParts = uploadedImages.map(img => ({
        inlineData: { data: img.split(',')[1], mimeType: "image/png" }
      }));

      // Step 1: Analyze product using all images
      const analysisResponse = await withRetry(() => ai.models.generateContent({
        model: MODELS.ANALYSIS,
        contents: [
          {
            parts: [
              { text: "Analyze these images of the same product from different angles. Describe this product in extreme detail for an AI image generator. Focus on its shape, color, material, texture, branding, and unique features. The goal is to recreate it accurately in different scenes. Be concise but thorough." },
              ...imageParts
            ]
          }
        ],
      }));

      const description = analysisResponse.text || "the product in the images";
      setProductDescription(description);

      // Step 2: Generate each item
      for (let i = 0; i < initialItems.length; i++) {
        setItems(prev => prev.map((item, idx) => 
          idx === i ? { ...item, status: 'processing' } : item
        ));

        const item = initialItems[i];
        const finalPrompt = item.prompt.replace('[PRODUCT]', description);

        try {
          // Re-create AI instance for each generation to ensure fresh key
          const freshAi = new GoogleGenAI({ apiKey: (process.env.API_KEY || process.env.GEMINI_API_KEY) as string });
          
          if (item.type === 'image') {
            const imageResponse = await withRetry(() => freshAi.models.generateContent({
              model: MODELS.IMAGE,
              contents: {
                parts: [
                  { text: finalPrompt },
                  ...imageParts // Provide all input images as context
                ]
              },
              config: {
                imageConfig: {
                  aspectRatio: "1:1",
                  imageSize: "1K"
                }
              }
            }));

            let imageUrl = '';
            for (const part of imageResponse.candidates?.[0]?.content?.parts || []) {
              if (part.inlineData) {
                imageUrl = `data:image/png;base64,${part.inlineData.data}`;
                break;
              }
            }

            if (imageUrl) {
              setItems(prev => prev.map((it, idx) => 
                idx === i ? { ...it, status: 'completed', url: imageUrl } : it
              ));
            } else {
              throw new Error("No image data received");
            }
          } else {
            // Video generation - Veo supports up to 3 reference images
            const videoRefImages = uploadedImages.slice(0, 3).map(img => ({
              image: {
                imageBytes: img.split(',')[1],
                mimeType: 'image/png',
              },
              referenceType: "ASSET" as any
            }));

            let operation = await withRetry(() => freshAi.models.generateVideos({
              model: MODELS.VIDEO,
              prompt: finalPrompt,
              config: {
                numberOfVideos: 1,
                resolution: '720p',
                aspectRatio: '16:9',
                referenceImages: videoRefImages
              }
            }));

            while (!operation.done) {
              await new Promise(resolve => setTimeout(resolve, 5000));
              operation = await withRetry(() => freshAi.operations.getVideosOperation({ operation }));
            }

            const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
            if (downloadLink) {
              const videoResponse = await fetch(downloadLink, {
                headers: { 'x-goog-api-key': (process.env.API_KEY || process.env.GEMINI_API_KEY) as string },
              });
              const blob = await videoResponse.blob();
              const videoUrl = URL.createObjectURL(blob);
              
              setItems(prev => prev.map((it, idx) => 
                idx === i ? { ...it, status: 'completed', url: videoUrl } : it
              ));
            } else {
              throw new Error("No video data received");
            }
          }
        } catch (err: any) {
          console.error(`Error generating ${item.title}:`, err);
          setItems(prev => prev.map((it, idx) => 
            idx === i ? { ...it, status: 'error' } : it
          ));
          
          if (err.message?.includes("entity was not found")) {
            setHasApiKey(false);
            setError("API Key session expired or invalid. Please select your key again.");
            break;
          }
        }
      }
    } catch (err: any) {
      console.error("Generation failed:", err);
      setError("Failed to process the product. Please try again.");
    } finally {
      setIsProcessing(false);
    }
  };

  const retryItem = async (itemId: string) => {
    const item = items.find(i => i.id === itemId);
    if (!item || uploadedImages.length === 0 || !productDescription) return;

    setItems(prev => prev.map(i => 
      i.id === itemId ? { ...i, status: 'processing', url: undefined } : i
    ));

    try {
      const currentApiKey = (process.env.API_KEY || process.env.GEMINI_API_KEY) as string;
      const freshAi = new GoogleGenAI({ apiKey: currentApiKey });
      
      const imageParts = uploadedImages.map(img => ({
        inlineData: { data: img.split(',')[1], mimeType: "image/png" }
      }));
      
      const finalPrompt = item.prompt.replace('[PRODUCT]', productDescription);

      if (item.type === 'image') {
        const imageResponse = await withRetry(() => freshAi.models.generateContent({
          model: MODELS.IMAGE,
          contents: {
            parts: [
              { text: finalPrompt },
              ...imageParts
            ]
          },
          config: {
            imageConfig: {
              aspectRatio: "1:1",
              imageSize: "1K"
            }
          }
        }));

        let imageUrl = '';
        for (const part of imageResponse.candidates?.[0]?.content?.parts || []) {
          if (part.inlineData) {
            imageUrl = `data:image/png;base64,${part.inlineData.data}`;
            break;
          }
        }

        if (imageUrl) {
          setItems(prev => prev.map(i => 
            i.id === itemId ? { ...i, status: 'completed', url: imageUrl } : i
          ));
        } else {
          throw new Error("No image data received");
        }
      } else {
        // Video generation
        const videoRefImages = uploadedImages.slice(0, 3).map(img => ({
          image: {
            imageBytes: img.split(',')[1],
            mimeType: 'image/png',
          },
          referenceType: "ASSET" as any
        }));

        let operation = await withRetry(() => freshAi.models.generateVideos({
          model: MODELS.VIDEO,
          prompt: finalPrompt,
          config: {
            numberOfVideos: 1,
            resolution: '720p',
            aspectRatio: '16:9',
            referenceImages: videoRefImages
          }
        }));

        while (!operation.done) {
          await new Promise(resolve => setTimeout(resolve, 5000));
          operation = await withRetry(() => freshAi.operations.getVideosOperation({ operation }));
        }

        const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
        if (downloadLink) {
          const videoResponse = await fetch(downloadLink, {
            headers: { 'x-goog-api-key': currentApiKey },
          });
          const blob = await videoResponse.blob();
          const videoUrl = URL.createObjectURL(blob);
          
          setItems(prev => prev.map(i => 
            i.id === itemId ? { ...i, status: 'completed', url: videoUrl } : i
          ));
        } else {
          throw new Error("No video data received");
        }
      }
    } catch (err: any) {
      console.error(`Error retrying ${item.title}:`, err);
      setItems(prev => prev.map(i => 
        i.id === itemId ? { ...i, status: 'error' } : i
      ));
      
      if (err.message?.includes("entity was not found")) {
        setHasApiKey(false);
        setError("API Key session expired or invalid. Please select your key again.");
      }
    }
  };

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 font-sans selection:bg-neutral-900 selection:text-white">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-neutral-200">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-neutral-900 rounded-lg flex items-center justify-center">
              <Camera className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-xl font-bold tracking-tight">AI Product Studio</h1>
          </div>
          
          {!hasApiKey && (
            <button
              onClick={handleOpenKeyDialog}
              className="flex items-center gap-2 px-4 py-2 bg-amber-50 text-amber-700 rounded-full text-sm font-medium hover:bg-amber-100 transition-colors border border-amber-200"
            >
              <Key className="w-4 h-4" />
              Connect API Key
            </button>
          )}
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-12">
        <div className="grid lg:grid-cols-12 gap-12">
          {/* Left Column: Upload & Controls */}
          <div className="lg:col-span-4 space-y-8">
            <section className="space-y-4">
              <h2 className="text-2xl font-bold tracking-tight">Source Product</h2>
              <p className="text-neutral-500 text-sm">
                Upload up to 5 photos of your product from different angles. This helps the AI understand the product perfectly.
              </p>
              
              <div className="grid grid-cols-2 gap-4">
                <AnimatePresence>
                  {uploadedImages.map((img, idx) => (
                    <motion.div 
                      key={idx}
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      className="relative aspect-square rounded-xl border border-neutral-200 overflow-hidden bg-white group"
                    >
                      <img 
                        src={img} 
                        alt={`Product view ${idx + 1}`} 
                        className="w-full h-full object-contain p-2"
                        referrerPolicy="no-referrer"
                      />
                      <button
                        onClick={() => removeImage(idx)}
                        className="absolute top-1 right-1 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-lg"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </motion.div>
                  ))}
                </AnimatePresence>
                
                {uploadedImages.length < 5 && (
                  <div 
                    {...getRootProps()} 
                    className={cn(
                      "relative aspect-square rounded-xl border-2 border-dashed transition-all cursor-pointer flex flex-col items-center justify-center text-center p-4",
                      isDragActive ? "border-neutral-900 bg-neutral-100" : "border-neutral-200 hover:border-neutral-400 bg-white"
                    )}
                  >
                    <input {...getInputProps()} />
                    <Plus className="w-6 h-6 text-neutral-400 mb-2" />
                    <p className="text-[10px] font-medium text-neutral-500 uppercase tracking-wider">Add Photo</p>
                  </div>
                )}
              </div>

              <button
                onClick={startGeneration}
                disabled={uploadedImages.length === 0 || !hasApiKey || isProcessing}
                className={cn(
                  "w-full py-4 rounded-xl font-bold text-lg transition-all flex items-center justify-center gap-3",
                  uploadedImages.length === 0 || !hasApiKey || isProcessing
                    ? "bg-neutral-200 text-neutral-400 cursor-not-allowed"
                    : "bg-neutral-900 text-white hover:bg-neutral-800 active:scale-[0.98] shadow-xl shadow-neutral-900/10"
                )}
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Generating Studio Shots...
                  </>
                ) : (
                  <>
                    <Camera className="w-5 h-5" />
                    Generate Photography
                  </>
                )}
              </button>

              {error && (
                <div className="p-4 bg-red-50 border border-red-100 rounded-xl flex gap-3 text-red-600 text-sm">
                  <AlertCircle className="w-5 h-5 shrink-0" />
                  <p>{error}</p>
                </div>
              )}

              {!hasApiKey && (
                <div className="p-4 bg-amber-50 border border-amber-100 rounded-xl space-y-3">
                  <div className="flex gap-3 text-amber-700 text-sm">
                    <Key className="w-5 h-5 shrink-0" />
                    <p>
                      This app requires a paid Gemini API key for high-quality image and video generation.
                    </p>
                  </div>
                  <a 
                    href="https://ai.google.dev/gemini-api/docs/billing" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-xs text-amber-600 underline block"
                  >
                    Learn about Gemini API billing
                  </a>
                </div>
              )}
            </section>

            {productDescription && (
              <section className="space-y-3 p-6 bg-white rounded-2xl border border-neutral-200">
                <h3 className="text-sm font-bold uppercase tracking-wider text-neutral-400">AI Analysis</h3>
                <p className="text-sm text-neutral-600 leading-relaxed italic">
                  "{productDescription}"
                </p>
              </section>
            )}
          </div>

          {/* Right Column: Gallery */}
          <div className="lg:col-span-8">
            <div className="flex items-center justify-between mb-8">
              <h2 className="text-2xl font-bold tracking-tight">Studio Gallery</h2>
              {items.length > 0 && (
                <div className="text-sm font-medium text-neutral-500">
                  {items.filter(i => i.status === 'completed').length} / {items.length} completed
                </div>
              )}
            </div>

            {items.length === 0 ? (
              <div className="h-[600px] rounded-3xl border-2 border-dashed border-neutral-200 flex flex-col items-center justify-center text-neutral-400 bg-white/50">
                <ImageIcon className="w-12 h-12 mb-4 opacity-20" />
                <p className="text-lg font-medium">Your studio shots will appear here</p>
                <p className="text-sm">Upload a product and click generate to start</p>
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 gap-6">
                <AnimatePresence mode="popLayout">
                  {items.map((item) => (
                    <motion.div
                      key={item.id}
                      layout
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      className="group relative bg-white rounded-3xl border border-neutral-200 overflow-hidden shadow-sm hover:shadow-xl transition-all duration-500"
                    >
                      <div className="aspect-square relative overflow-hidden bg-neutral-100">
                        {item.status === 'processing' && (
                          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-white/80 backdrop-blur-sm">
                            <Loader2 className="w-8 h-8 text-neutral-900 animate-spin mb-3" />
                            <p className="text-xs font-bold uppercase tracking-widest text-neutral-400">Processing</p>
                          </div>
                        )}
                        
                        {item.status === 'pending' && (
                          <div className="absolute inset-0 flex items-center justify-center opacity-20">
                            {item.type === 'image' ? <ImageIcon className="w-12 h-12" /> : <Video className="w-12 h-12" />}
                          </div>
                        )}

                        {item.status === 'error' && (
                          <div className="absolute inset-0 flex flex-col items-center justify-center text-red-400 bg-red-50/50">
                            <AlertCircle className="w-8 h-8 mb-2" />
                            <p className="text-xs font-bold">Generation Failed</p>
                          </div>
                        )}

                        {item.url && (
                          item.type === 'image' ? (
                            <img 
                              src={item.url} 
                              alt={item.title} 
                              className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
                              referrerPolicy="no-referrer"
                            />
                          ) : (
                            <video 
                              src={item.url} 
                              className="w-full h-full object-cover"
                              autoPlay
                              loop
                              muted
                              playsInline
                            />
                          )
                        )}

                        {item.status === 'completed' && (
                          <div className="absolute top-4 right-4 z-20">
                            <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center shadow-lg">
                              <CheckCircle2 className="w-5 h-5 text-white" />
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="p-6">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <h3 className="font-bold text-lg">{item.title}</h3>
                            <p className="text-sm text-neutral-500 mt-1">{item.description}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            {(item.status === 'completed' || item.status === 'error') && (
                              <button 
                                onClick={() => retryItem(item.id)}
                                className="p-2 rounded-full hover:bg-neutral-100 transition-colors text-neutral-400 hover:text-neutral-900"
                                title="Regenerate"
                              >
                                <RotateCcw className="w-5 h-5" />
                              </button>
                            )}
                            {item.url && (
                              <a 
                                href={item.url} 
                                download={`${item.title.toLowerCase().replace(' ', '-')}.png`}
                                className="p-2 rounded-full hover:bg-neutral-100 transition-colors"
                                title="Download"
                              >
                                <Download className="w-5 h-5 text-neutral-400" />
                              </a>
                            )}
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-neutral-200 py-12 bg-white mt-24">
        <div className="max-w-7xl mx-auto px-4 text-center">
          <p className="text-sm text-neutral-400">
            Powered by Google Gemini 3.1 & Veo 3.1 • Professional AI Product Photography
          </p>
        </div>
      </footer>
    </div>
  );
}
