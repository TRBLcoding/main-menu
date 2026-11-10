import { useState, useEffect, useMemo } from 'react';
import { pb } from './pocketbaseClient';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import { Search, Plus, Clock, Users, ChefHat, X, Loader2, Trash2, Wand2, PenLine, ImagePlus, Edit2 } from 'lucide-react';
import imageCompression from 'browser-image-compression';

const genAI = new GoogleGenerativeAI(window.HA_CONFIG.GEMINI_API_KEY);

const emptyManualRecipe = {
  title: '',
  summary: '',
  prep_time_minutes: 0,
  cook_time_minutes: 0,
  servings: 1,
  image_url: '', // Used for local preview or fetched PB url
  ingredients: [{ amount: '', unit: '', name: '' }],
  instructions: ['']
};

async function fileToGenerativePart(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve({ inlineData: { data: reader.result.split(',')[1], mimeType: file.type } });
    reader.readAsDataURL(file);
  });
}

export default function App() {
  const [recipes, setRecipes] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  
  // Modal States
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [addMode, setAddMode] = useState('ai'); 
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [selectedRecipe, setSelectedRecipe] = useState(null);
  
  // AI States
  const [aiInputMode, setAiInputMode] = useState('text');
  const [pasteText, setPasteText] = useState('');
  const [importUrl, setImportUrl] = useState('');
  const [importImage, setImportImage] = useState(null);
  const [isParsing, setIsParsing] = useState(false);

  // Manual/Edit Entry States
  const [manualRecipe, setManualRecipe] = useState(emptyManualRecipe);
  const [imageFile, setImageFile] = useState(null); // Added state to hold the actual file before saving
  const [isSavingManual, setIsSavingManual] = useState(false);
  const [isUploadingImage, setIsUploadingImage] = useState(false);

  // --- AUTO LOGIN & FETCH (POCKETBASE) ---
  useEffect(() => {
    async function authenticateAndFetch() {
      setIsLoading(true);
      try {
        // 1. Remove VITE_ prefix to match window.HA_CONFIG created in run.sh
        const email = window.HA_CONFIG.AUTO_LOGIN_EMAIL;
        const password = window.HA_CONFIG.AUTO_LOGIN_PASSWORD;

        // 2. Use _superusers collection for PocketBase v0.23+
        await pb.collection('_superusers').authWithPassword(email, password, { requestKey: null });

        await fetchRecipes();
      } catch (error) {
        console.error("Auto-login failed:", error.message);
        alert("Login Failed. Check your PocketBase Superuser credentials in Home Assistant.");
        setIsLoading(false);
      }
    }
    authenticateAndFetch();
  }, []);

  async function fetchRecipes() {
    try {
      // Fix 2: Voeg requestKey toe aan het ophalen van de lijst
      const records = await pb.collection('recipes').getFullList({ 
          sort: '-created',
          requestKey: null 
      });
      
      const mappedRecords = records.map(record => ({
        ...record,
        image_url: record.image ? pb.files.getURL(record, record.image) : ''
      }));
      
      setRecipes(mappedRecords);
    } catch (error) {
        console.error("Fetch error:", error);
    }
    setIsLoading(false);
  }

  // --- UNIQUE INGREDIENTS (Autocomplete) ---
  const suggestedIngredients = useMemo(() => {
    const allIngredients = new Set();
    recipes.forEach(recipe => {
      if (recipe.ingredients) {
        recipe.ingredients.forEach(ing => {
          if (ing.name && ing.name.trim() !== '') allIngredients.add(ing.name.trim().toLowerCase());
        });
      }
    });
    return Array.from(allIngredients).sort();
  }, [recipes]);

  // --- IMAGE SELECTION & COMPRESSION (NO IMMEDIATE UPLOAD) ---
  async function processSelectedImage(file) {
    if (!file || !file.type.startsWith('image/')) return;
    setIsUploadingImage(true);
    try {
      const options = { maxSizeMB: 1, maxWidthOrHeight: 1200, useWebWorker: true };
      const compressedFile = await imageCompression(file, options);
      
      // Save file to state for later, and create a temporary local URL for preview
      setImageFile(compressedFile);
      setManualRecipe(prev => ({ ...prev, image_url: URL.createObjectURL(compressedFile) }));
    } catch (error) {
      console.error("Image processing error:", error);
      alert("Failed to process image: " + error.message);
    } finally {
      setIsUploadingImage(false);
    }
  }

  function handleImageUpload(e) {
    const file = e.target.files?.[0];
    if (file) processSelectedImage(file);
  }

  function handlePaste(e) {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          processSelectedImage(file);
          break;
        }
      }
    }
  }

  function handleAIPaste(e) {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          setImportImage(file);
          break;
        }
      }
    }
  }

  // --- AI PARSING ---
  async function parseRecipeWithAI() {
    setIsParsing(true);
    try {
      const model = genAI.getGenerativeModel({
        model: "gemini-3.5-flash-lite",
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: SchemaType.OBJECT,
            properties: {
              title: { type: SchemaType.STRING },
              summary: { type: SchemaType.STRING },
              prep_time_minutes: { type: SchemaType.INTEGER },
              cook_time_minutes: { type: SchemaType.INTEGER },
              servings: { type: SchemaType.INTEGER },
              ingredients: { type: SchemaType.ARRAY, items: { type: SchemaType.OBJECT, properties: { amount: { type: SchemaType.STRING }, unit: { type: SchemaType.STRING }, name: { type: SchemaType.STRING } } } },
              instructions: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } }
            },
            required: ["title", "ingredients", "instructions"]
          }
        }
      });

      let promptArgs = [];
      const basePrompt = "Extract the recipe details into JSON. Extract exact times, servings, ingredients, and instructions.";

      if (aiInputMode === 'text') {
        if (!pasteText.trim()) throw new Error("Please enter recipe text.");
        promptArgs = [`${basePrompt}\n\nText:\n${pasteText}`];
      } else if (aiInputMode === 'url') {
        if (!importUrl.trim()) throw new Error("Please enter a URL.");
        const response = await fetch(`https://corsproxy.io/?${encodeURIComponent(importUrl)}`);
        if (!response.ok) throw new Error("Failed to fetch the website URL.");
        const html = await response.text();
        promptArgs = [`${basePrompt} Find the main recipe hidden in this HTML code:\n\n${html}`];
      } else if (aiInputMode === 'image') {
        if (!importImage) throw new Error("Please upload an image.");
        const imagePart = await fileToGenerativePart(importImage);
        promptArgs = [`${basePrompt} Read the recipe from this uploaded image.`, imagePart];
      }

      let result;
      let retries = 3;
      while (retries > 0) {
        try {
          result = await model.generateContent(promptArgs);
          break;
        } catch (e) {
          if (e.message.includes("503") && retries > 1) {
            await new Promise(resolve => setTimeout(resolve, 2000));
            retries--;
          } else {
            throw e;
          }
        }
      }

      const rawText = result.response.text().replace(/```json/gi, '').replace(/```/g, '').trim();
      const parsedData = JSON.parse(rawText);

      // Save to PocketBase (Without an image initially)
      const record = await pb.collection('recipes').create(parsedData);
      
      setRecipes([{ ...record, image_url: '' }, ...recipes]);
      closeAddModal();

    } catch (error) {
      console.error(error);
      alert(`Parsing failed: ${error.message}`);
    } finally {
      setIsParsing(false);
    }
  }

  // --- SAVE & EDIT LOGIC (POCKETBASE) ---
  async function saveManualRecipe() {
    if (!manualRecipe.title) return alert("Title is required!");
    setIsSavingManual(true);
    
    try {
      // 1. Prepare FormData (PocketBase requires FormData for files + JSON)
      const formData = new FormData();
      formData.append('title', manualRecipe.title);
      formData.append('summary', manualRecipe.summary || '');
      formData.append('prep_time_minutes', manualRecipe.prep_time_minutes || 0);
      formData.append('cook_time_minutes', manualRecipe.cook_time_minutes || 0);
      formData.append('servings', manualRecipe.servings || 1);
      
      // Arrays must be stringified for PocketBase JSON fields
      const cleanedIngredients = manualRecipe.ingredients.filter(i => i.name.trim() !== '');
      const cleanedInstructions = manualRecipe.instructions.filter(i => i.trim() !== '');
      formData.append('ingredients', JSON.stringify(cleanedIngredients));
      formData.append('instructions', JSON.stringify(cleanedInstructions));
      
      // Append the compressed image file if one was selected
      if (imageFile) {
        formData.append('image', imageFile);
      } else if (manualRecipe.image_url === '') {
        // If the user removed the image in the UI, tell PocketBase to clear it
        formData.append('image', ''); 
      }

      let savedRecord;
      if (manualRecipe.id) {
        // UPDATE EXISTING
        savedRecord = await pb.collection('recipes').update(manualRecipe.id, formData);
        savedRecord.image_url = savedRecord.image ? pb.files.getURL(savedRecord, savedRecord.image) : '';
        
        setRecipes(recipes.map(r => r.id === savedRecord.id ? savedRecord : r));
        closeAddModal();
        setSelectedRecipe(savedRecord);
        setIsDetailModalOpen(true);
      } else {
        // INSERT NEW
        savedRecord = await pb.collection('recipes').create(formData);
        savedRecord.image_url = savedRecord.image ? pb.files.getURL(savedRecord, savedRecord.image) : '';
        
        setRecipes([savedRecord, ...recipes]);
        closeAddModal();
      }
    } catch (error) {
      console.error("Save error:", error);
      alert("Failed to save recipe: " + error.message);
    } finally {
      setIsSavingManual(false);
    }
  }

  function startEditing(recipe) {
    setIsDetailModalOpen(false);
    setManualRecipe(recipe);
    setImageFile(null); // Reset pending image upload
    setAddMode('manual');
    setIsAddModalOpen(true);
  }

  function closeAddModal() {
    setIsAddModalOpen(false);
    setPasteText('');
    setManualRecipe(emptyManualRecipe);
    setImageFile(null);
    setAddMode('ai');
  }

  async function deleteRecipe(id) {
    if (!confirm("Delete this recipe?")) return;
    try {
      await pb.collection('recipes').delete(id);
      setRecipes(recipes.filter(r => r.id !== id));
      setIsDetailModalOpen(false);
    } catch (error) {
      alert("Failed to delete recipe.");
    }
  }

  const filteredRecipes = recipes.filter(r => 
    r.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    r.tags?.some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  return (
    <div className="min-h-screen max-w-6xl mx-auto p-6">
      <header className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
        <div className="flex items-center gap-3 text-emerald-600">
          <ChefHat size={32} />
          <h1 className="text-3xl font-bold">Main Menu ;)</h1>
        </div>
        
        <div className="flex w-full md:w-auto gap-4">
          <div className="relative flex-1 md:w-80">
            <Search className="absolute left-3 top-3 text-gray-400" size={20} />
            <input type="text" placeholder="Search recipes..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full pl-10 pr-4 py-2 border rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none" />
          </div>
          <button onClick={() => { setManualRecipe(emptyManualRecipe); setImageFile(null); setIsAddModalOpen(true); }} className="bg-emerald-600 text-white px-4 py-2 rounded-xl flex items-center gap-2 hover:bg-emerald-700 transition">
            <Plus size={20} /> <span className="hidden md:inline">Add</span>
          </button>
        </div>
      </header>

      {isLoading ? (
        <div className="flex justify-center mt-20"><Loader2 className="animate-spin text-emerald-600" size={40} /></div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredRecipes.map(recipe => (
            <div key={recipe.id} onClick={() => { setSelectedRecipe(recipe); setIsDetailModalOpen(true); }} className="bg-white rounded-2xl shadow-sm hover:shadow-md transition cursor-pointer border overflow-hidden">
              <div className="h-48 bg-emerald-100 flex items-center justify-center overflow-hidden">
                {recipe.image_url ? (
                  <img src={recipe.image_url} alt={recipe.title} className="w-full h-full object-cover" />
                ) : (
                  <ChefHat size={48} className="text-emerald-300" />
                )}
              </div>
              <div className="p-5">
                <h3 className="font-bold text-xl mb-2 line-clamp-1">{recipe.title}</h3>
                <p className="text-gray-500 text-sm mb-4 line-clamp-2">{recipe.summary || 'No summary available.'}</p>
                <div className="flex gap-4 text-sm text-gray-600">
                  <span className="flex items-center gap-1"><Clock size={16}/> {recipe.prep_time_minutes + recipe.cook_time_minutes}m</span>
                  <span className="flex items-center gap-1"><Users size={16}/> {recipe.servings}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add / Edit Recipe Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 overflow-y-auto">
          <div className="bg-white rounded-2xl p-6 w-full max-w-3xl my-8">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold">{manualRecipe.id ? 'Edit Recipe' : 'Add Recipe'}</h2>
              <button onClick={closeAddModal} className="p-2 hover:bg-gray-100 rounded-full transition"><X className="text-gray-500" /></button>
            </div>

            {!manualRecipe.id && (
              <div className="flex gap-2 mb-6 bg-gray-100 p-1 rounded-xl">
                <button onClick={() => setAddMode('ai')} className={`flex-1 py-2 rounded-lg font-medium flex items-center justify-center gap-2 transition ${addMode === 'ai' ? 'bg-white shadow-sm text-emerald-600' : 'text-gray-500'}`}>
                  <Wand2 size={18} /> Auto AI
                </button>
                <button onClick={() => setAddMode('manual')} className={`flex-1 py-2 rounded-lg font-medium flex items-center justify-center gap-2 transition ${addMode === 'manual' ? 'bg-white shadow-sm text-emerald-600' : 'text-gray-500'}`}>
                  <PenLine size={18} /> Manual
                </button>
              </div>
            )}

            {addMode === 'ai' && !manualRecipe.id && (
            <div className="animate-in fade-in duration-200 space-y-4">
                <div className="flex gap-2 text-sm mb-2">
                <button onClick={() => setAiInputMode('text')} className={`px-4 py-1 rounded-full ${aiInputMode === 'text' ? 'bg-emerald-100 text-emerald-700 font-bold' : 'text-gray-500 hover:bg-gray-100'}`}>Paste Text</button>
                <button onClick={() => setAiInputMode('url')} className={`px-4 py-1 rounded-full ${aiInputMode === 'url' ? 'bg-emerald-100 text-emerald-700 font-bold' : 'text-gray-500 hover:bg-gray-100'}`}>From URL</button>
                <button onClick={() => setAiInputMode('image')} className={`px-4 py-1 rounded-full ${aiInputMode === 'image' ? 'bg-emerald-100 text-emerald-700 font-bold' : 'text-gray-500 hover:bg-gray-100'}`}>Upload Screenshot</button>
                </div>

                {aiInputMode === 'text' && (
                <textarea value={pasteText} onChange={(e) => setPasteText(e.target.value)} placeholder="Paste recipe text..." className="w-full h-48 border rounded-xl p-4 focus:ring-2 focus:ring-emerald-500 outline-none resize-none" />
                )}

                {aiInputMode === 'url' && (
                <input type="url" value={importUrl} onChange={(e) => setImportUrl(e.target.value)} placeholder="https://www.recipeblog.com/..." className="w-full p-4 border rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none" />
                )}

                {aiInputMode === 'image' && (
                <div tabIndex={0} onPaste={handleAIPaste} className="border-2 border-dashed border-gray-300 rounded-xl p-8 flex flex-col items-center justify-center bg-gray-50 focus:border-emerald-500 focus:outline-none cursor-pointer min-h-[160px]">
                    {importImage ? (
                    <div className="text-center">
                        <p className="text-emerald-600 font-bold mb-2">📸 Selected: {importImage.name}</p>
                        <button onClick={() => setImportImage(null)} className="text-red-500 text-sm hover:underline font-bold">Remove Image</button>
                    </div>
                    ) : (
                    <div className="text-center">
                        <label className="cursor-pointer text-emerald-600 font-bold hover:underline">
                        Click to select or press Ctrl+V to paste
                        <input type="file" accept="image/*" className="hidden" onChange={(e) => setImportImage(e.target.files[0])} />
                        </label>
                        <p className="text-gray-400 text-sm mt-2">Paste a screenshot of a recipe page or cookbook</p>
                    </div>
                    )}
                </div>
                )}

                <button onClick={parseRecipeWithAI} disabled={isParsing} className="w-full bg-emerald-600 text-white py-3 rounded-xl font-bold hover:bg-emerald-700 disabled:opacity-50 flex justify-center items-center gap-2">
                {isParsing ? <><Loader2 className="animate-spin" size={20} /> Extracting with Gemini...</> : 'Extract & Save with AI'}
                </button>
            </div>
            )}

            {addMode === 'manual' && (
              <div className="space-y-6 animate-in fade-in duration-200 h-[60vh] overflow-y-auto pr-2">
            
            {/* Image Upload Area */}
            <div tabIndex={0} onPaste={handlePaste} className="border-2 border-dashed border-gray-200 rounded-xl p-6 flex flex-col items-center justify-center gap-3 relative overflow-hidden bg-gray-50 focus:border-emerald-500 focus:outline-none cursor-pointer">
            {manualRecipe.image_url ? (
                <div className="relative w-full h-48 rounded-lg overflow-hidden group">
                <img src={manualRecipe.image_url} alt="Preview" className="w-full h-full object-cover" />
                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition flex items-center justify-center gap-4">
                    <label className="cursor-pointer bg-white text-gray-800 px-4 py-2 rounded-lg font-bold hover:bg-gray-100 flex items-center gap-2">
                    <Edit2 size={16} /> Change Image
                    <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} disabled={isUploadingImage} />
                    </label>
                    <button onClick={() => { setManualRecipe({...manualRecipe, image_url: ''}); setImageFile(null); }} className="bg-red-500 text-white px-4 py-2 rounded-lg font-bold hover:bg-red-600 flex items-center gap-2">
                    <Trash2 size={16} /> Remove
                    </button>
                </div>
                </div>
            ) : (
                <>
                <ImagePlus size={40} className="text-gray-400" />
                <div className="text-center">
                    <label className="cursor-pointer text-emerald-600 font-bold hover:underline">
                    Click to upload or press Ctrl+V to paste
                    <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} disabled={isUploadingImage} />
                    </label>
                    <p className="text-gray-400 text-sm mt-1">Images are compressed automatically</p>
                </div>
                {isUploadingImage && (
                    <div className="absolute inset-0 bg-white/80 flex items-center justify-center flex-col gap-2">
                    <Loader2 className="animate-spin text-emerald-600" size={32} />
                    <span className="font-bold text-gray-600">Compressing...</span>
                    </div>
                )}
                </>
            )}
            </div>
                <div className="space-y-4">
                  <input type="text" placeholder="Recipe Title *" value={manualRecipe.title} onChange={e => setManualRecipe({...manualRecipe, title: e.target.value})} className="w-full p-3 border rounded-xl font-bold text-lg focus:ring-2 focus:ring-emerald-500 outline-none" />
                  <textarea placeholder="Short Summary" value={manualRecipe.summary} onChange={e => setManualRecipe({...manualRecipe, summary: e.target.value})} className="w-full p-3 border rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none" rows="2" />
                  
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Prep Time (min)</label>
                      <input type="number" value={manualRecipe.prep_time_minutes || ''} onChange={e => setManualRecipe({...manualRecipe, prep_time_minutes: parseInt(e.target.value) || 0})} className="w-full p-3 border rounded-xl outline-none focus:ring-2 focus:ring-emerald-500" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Cook Time (min)</label>
                      <input type="number" value={manualRecipe.cook_time_minutes || ''} onChange={e => setManualRecipe({...manualRecipe, cook_time_minutes: parseInt(e.target.value) || 0})} className="w-full p-3 border rounded-xl outline-none focus:ring-2 focus:ring-emerald-500" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Servings</label>
                      <input type="number" value={manualRecipe.servings || ''} onChange={e => setManualRecipe({...manualRecipe, servings: parseInt(e.target.value) || 1})} className="w-full p-3 border rounded-xl outline-none focus:ring-2 focus:ring-emerald-500" />
                    </div>
                  </div>
                </div>

                <datalist id="ingredient-suggestions">
                  {suggestedIngredients.map((name, idx) => <option key={idx} value={name} />)}
                </datalist>

                <div>
                  <h3 className="font-bold mb-2 flex items-center justify-between">
                    Ingredients
                    <button onClick={() => setManualRecipe({...manualRecipe, ingredients: [...manualRecipe.ingredients, { amount: '', unit: '', name: '' }]})} className="text-emerald-600 text-sm flex items-center gap-1 hover:underline"><Plus size={16}/> Add Row</button>
                  </h3>
                  <div className="space-y-2">
                    {manualRecipe.ingredients.map((ing, index) => (
                      <div key={index} className="flex gap-2">
                        <input type="text" placeholder="Amount (e.g. 2)" value={ing.amount} onChange={e => { const newIng = [...manualRecipe.ingredients]; newIng[index].amount = e.target.value; setManualRecipe({...manualRecipe, ingredients: newIng}); }} className="w-1/4 p-2 border rounded-lg outline-none focus:ring-2 focus:ring-emerald-500" />
                        <input type="text" placeholder="Unit (e.g. cups)" value={ing.unit} onChange={e => { const newIng = [...manualRecipe.ingredients]; newIng[index].unit = e.target.value; setManualRecipe({...manualRecipe, ingredients: newIng}); }} className="w-1/4 p-2 border rounded-lg outline-none focus:ring-2 focus:ring-emerald-500" />
                        <input type="text" list="ingredient-suggestions" placeholder="Ingredient name *" value={ing.name} onChange={e => { const newIng = [...manualRecipe.ingredients]; newIng[index].name = e.target.value; setManualRecipe({...manualRecipe, ingredients: newIng}); }} className="flex-1 p-2 border rounded-lg outline-none focus:ring-2 focus:ring-emerald-500" />
                        <button onClick={() => { const newIng = manualRecipe.ingredients.filter((_, i) => i !== index); setManualRecipe({...manualRecipe, ingredients: newIng}); }} className="p-2 text-red-400 hover:bg-red-50 rounded-lg"><Trash2 size={20}/></button>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <h3 className="font-bold mb-2 flex items-center justify-between">
                    Instructions
                    <button onClick={() => setManualRecipe({...manualRecipe, instructions: [...manualRecipe.instructions, '']})} className="text-emerald-600 text-sm flex items-center gap-1 hover:underline"><Plus size={16}/> Add Step</button>
                  </h3>
                  <div className="space-y-2">
                    {manualRecipe.instructions.map((step, index) => (
                      <div key={index} className="flex gap-2 items-start">
                        <span className="mt-2 text-gray-400 font-bold w-6">{index + 1}.</span>
                        <textarea placeholder="Instruction step..." value={step} onChange={e => { const newInst = [...manualRecipe.instructions]; newInst[index] = e.target.value; setManualRecipe({...manualRecipe, instructions: newInst}); }} className="flex-1 p-2 border rounded-lg outline-none focus:ring-2 focus:ring-emerald-500 resize-none" rows="2" />
                        <button onClick={() => { const newInst = manualRecipe.instructions.filter((_, i) => i !== index); setManualRecipe({...manualRecipe, instructions: newInst}); }} className="p-2 text-red-400 hover:bg-red-50 rounded-lg mt-1"><Trash2 size={20}/></button>
                      </div>
                    ))}
                  </div>
                </div>

                <button onClick={saveManualRecipe} disabled={isSavingManual || !manualRecipe.title || isUploadingImage} className="w-full bg-emerald-600 text-white py-3 rounded-xl font-bold hover:bg-emerald-700 disabled:opacity-50 flex justify-center items-center mt-4 sticky bottom-0 shadow-lg">
                  {isSavingManual ? <Loader2 className="animate-spin" size={20} /> : (manualRecipe.id ? 'Save Changes' : 'Save Recipe')}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Detail Modal */}
      {isDetailModalOpen && selectedRecipe && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
            
            {selectedRecipe.image_url && (
              <div className="h-64 w-full bg-gray-100 flex-shrink-0">
                <img src={selectedRecipe.image_url} alt={selectedRecipe.title} className="w-full h-full object-cover" />
              </div>
            )}

            <div className="p-6 border-b flex justify-between items-start bg-emerald-50">
              <div>
                <h2 className="text-3xl font-bold">{selectedRecipe.title}</h2>
                <div className="flex gap-4 mt-2 text-gray-600">
                  <span className="flex items-center gap-1"><Clock size={16}/> {selectedRecipe.prep_time_minutes + selectedRecipe.cook_time_minutes} min</span>
                  <span className="flex items-center gap-1"><Users size={16}/> {selectedRecipe.servings} servings</span>
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => startEditing(selectedRecipe)} className="p-2 text-emerald-600 hover:bg-emerald-100 rounded-lg transition" title="Edit Recipe"><Edit2 size={24} /></button>
                <button onClick={() => deleteRecipe(selectedRecipe.id)} className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition" title="Delete"><Trash2 size={24} /></button>
                <div className="w-px bg-gray-300 mx-1"></div>
                <button onClick={() => setIsDetailModalOpen(false)} className="p-2 text-gray-600 hover:bg-gray-200 rounded-lg transition" title="Close"><X size={24} /></button>
              </div>
            </div>
            <div className="p-6 overflow-y-auto flex-1 grid md:grid-cols-3 gap-8">
              <div className="md:col-span-1">
                <h3 className="font-bold text-xl mb-4 border-b pb-2">Ingredients</h3>
                <ul className="space-y-3">
                  {selectedRecipe.ingredients?.map((ing, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <input type="checkbox" className="mt-1 w-4 h-4 text-emerald-600 rounded" />
                      <span className="text-gray-700"><strong>{ing.amount} {ing.unit}</strong> {ing.name}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="md:col-span-2">
                <h3 className="font-bold text-xl mb-4 border-b pb-2">Instructions</h3>
                <ol className="space-y-4">
                  {selectedRecipe.instructions?.map((step, i) => (
                    <li key={i} className="flex gap-4">
                      <span className="flex-shrink-0 w-8 h-8 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold">{i + 1}</span>
                      <p className="text-gray-700 pt-1 leading-relaxed">{step}</p>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}