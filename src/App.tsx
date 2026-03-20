import { useEffect, useMemo, useRef, useState } from "react";
import { doc, setDoc, onSnapshot } from "firebase/firestore";
import { db } from "./firebase";
import { DEFAULT_HOUSEHOLD_ID, HOUSEHOLD_STORAGE_KEY } from "./household";

type Ingredient = {
  quantity: string;
  unit: string;
  name: string;
  completed?: boolean;
  category?: string;
  aisle?: string;
};

type Dish = {
  name: string;
  ingredients: Ingredient[];
};

function parseQuantity(value: string) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return null;
  const matches = trimmed.match(/-?\d+(?:\.\d+)?/g);
  if (!matches || matches.length === 0) return null;
  const total = matches
    .map((part) => Number(part))
    .filter((num) => Number.isFinite(num))
    .reduce((sum, num) => sum + num, 0);
  return Number.isFinite(total) ? total : null;
}

function singularizeWord(word: string) {
  const trimmed = String(word ?? "").trim();
  const lower = trimmed.toLowerCase();
  if (lower.endsWith("tomatoes")) return trimmed.slice(0, -2);
  if (lower.endsWith("potatoes")) return trimmed.slice(0, -2);
  if (lower.endsWith("ies") && trimmed.length > 3) return trimmed.slice(0, -3) + "y";
  if (lower.endsWith("ches") || lower.endsWith("shes")) return trimmed.slice(0, -2);
  if (lower.endsWith("ses") || lower.endsWith("xes") || lower.endsWith("zes")) return trimmed.slice(0, -2);
  if (lower.endsWith("s") && !lower.endsWith("ss")) return trimmed.slice(0, -1);
  return trimmed;
}

function pluralizeWord(word: string) {
  const singular = singularizeWord(word);
  const lower = singular.toLowerCase();
  if (lower.endsWith("tomato")) return singular + "es";
  if (lower.endsWith("potato")) return singular + "es";
  if (lower.endsWith("y") && !/[aeiou]y$/i.test(lower)) return singular.slice(0, -1) + "ies";
  if (
    lower.endsWith("s") ||
    lower.endsWith("x") ||
    lower.endsWith("z") ||
    lower.endsWith("ch") ||
    lower.endsWith("sh")
  ) {
    return singular + "es";
  }
  return singular + "s";
}

function normalizeName(name: string) {
  return singularizeWord(name).trim().toLowerCase();
}

function normalizeUnit(unit: string) {
  return singularizeWord(String(unit ?? "").trim()).toLowerCase();
}

function displayUnit(unit: string, quantity: string) {
  const baseUnit = singularizeWord(String(unit ?? "").trim());
  if (!baseUnit) return "";
  const nonPluralUnits = ["g", "kg", "mg", "lb", "oz", "ml", "l", "tbsp", "tsp"];
  if (nonPluralUnits.includes(baseUnit.toLowerCase())) return baseUnit;
  const parsed = parseQuantity(quantity);
  if (parsed !== null && parsed > 1) return pluralizeWord(baseUnit);
  return baseUnit;
}

function ingredientLabel(item: Ingredient) {
  const qty = String(item.quantity ?? "").trim();
  const parsed = parseQuantity(qty);
  const baseName = singularizeWord(item.name);
  const unit = displayUnit(item.unit, qty);
  const uncountable = [
    "pasta",
    "rice",
    "flour",
    "sugar",
    "salt",
    "pepper",
    "butter",
    "cheese",
    "bread",
    "milk",
    "yogurt",
    "spinach",
    "lettuce",
    "olive oil",
  ];
  let name = baseName;
  if (!uncountable.includes(baseName.toLowerCase())) {
    if (parsed !== null && parsed > 1) name = pluralizeWord(baseName);
  }
  const displayQty = parsed !== null ? String(parsed) : qty;
  return [displayQty, unit, name].filter(Boolean).join(" ");
}

function ingredientGroupKey(item: Ingredient) {
  return `${normalizeName(item.name)}__${normalizeUnit(item.unit)}__${item.completed ? "done" : "todo"}`;
}

function exactIngredientKey(item: Ingredient) {
  return `${normalizeName(item.name)}__${normalizeUnit(item.unit)}__${String(item.quantity ?? "").trim()}__${item.completed ? "done" : "todo"}`;
}

function sanitizeIngredient(raw: unknown): Ingredient | null {
  if (!raw || typeof raw !== "object") return null;
  const maybe = raw as Record<string, unknown>;
  const name = String(maybe.name ?? "").trim();
  if (!name) return null;
  return {
    quantity: String(maybe.quantity ?? "").trim(),
    unit: String(maybe.unit ?? "").trim(),
    name: singularizeWord(name),
    completed: !!maybe.completed,
    category: String(maybe.category ?? "").trim() || undefined,
    aisle: String(maybe.aisle ?? "").trim() || undefined,
  };
}

function sanitizeIngredients(raw: unknown): Ingredient[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => sanitizeIngredient(item)).filter((item): item is Ingredient => item !== null);
}

function mergeIngredientLists(items: Ingredient[]) {
  const map = new Map<string, Ingredient>();
  items.forEach((raw) => {
    const item = sanitizeIngredient(raw);
    if (!item) return;
    const key = ingredientGroupKey(item);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...item });
      return;
    }
    const currentQty = parseQuantity(existing.quantity);
    const addQty = parseQuantity(item.quantity);
    if (currentQty !== null && addQty !== null) {
      existing.quantity = String(currentQty + addQty);
    }
    if (!existing.category && item.category) {
      existing.category = item.category;
    }
    if (!existing.aisle && item.aisle) {
      existing.aisle = item.aisle;
    }
  });
  return Array.from(map.values());
}

function getCategory(name: string) {
  const item = normalizeName(name);
  const produce = ["tomato", "cucumber", "lettuce", "onion", "garlic", "carrot", "pepper", "spinach", "potato", "apple", "banana", "lemon", "lime", "avocado", "broccoli", "zucchini", "mushroom"];
  const dairy = ["milk", "cheese", "yogurt", "butter", "cream", "egg"];
  const pantry = ["pasta", "rice", "flour", "sugar", "salt", "beans", "lentil", "oil", "olive oil", "vinegar", "tomato sauce", "tortilla"];
  const meat = ["chicken", "beef", "pork", "turkey", "salmon", "fish"];
  const bakery = ["bread", "bagel", "bun", "roll", "croissant"];
  if (produce.includes(item)) return "Produce";
  if (dairy.includes(item)) return "Dairy";
  if (meat.includes(item)) return "Meat";
  if (pantry.includes(item)) return "Pantry";
  if (bakery.includes(item)) return "Bakery";
  return "Other";
}

function getCategoryIcon(category: string) {
  const icons: Record<string, string> = {
    Produce: "🥬",
    Dairy: "🥛",
    Meat: "🥩",
    Pantry: "🥫",
    Bakery: "🍞",
    Other: "🛒",
  };
  return icons[category] || "🛒";
}

const COMMON_INGREDIENT_SUGGESTIONS = [
  "tomato",
  "tomato sauce",
  "cherry tomato",
  "lettuce",
  "cucumber",
  "onion",
  "garlic",
  "carrot",
  "pepper",
  "spinach",
  "apple",
  "banana",
  "lemon",
  "lime",
  "avocado",
  "broccoli",
  "zucchini",
  "mushroom",
  "milk",
  "cheese",
  "yogurt",
  "butter",
  "cream",
  "egg",
  "bread",
  "bagel",
  "croissant",
  "pasta",
  "rice",
  "flour",
  "sugar",
  "salt",
  "olive oil",
  "vinegar",
  "beans",
  "lentils",
  "chicken",
  "beef",
  "pork",
  "salmon",
  "tortilla",
];

function buildSuggestions(value: string) {
  const lastLine = value.split("\n").pop()?.trim().toLowerCase() || "";
  if (!lastLine || /[0-9]/.test(lastLine)) return [];
  return COMMON_INGREDIENT_SUGGESTIONS.filter((item) => item.toLowerCase().includes(lastLine)).slice(0, 5);
}

function parseIngredientLine(line: string): Ingredient | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const units = [
    "g", "kg", "ml", "l", "lb", "oz", "cup", "cups", "tbsp", "tsp",
    "can", "cans", "jar", "jars", "clove", "cloves", "slice", "slices",
    "packet", "packets", "bottle", "bottles", "loaf", "loaves",
  ];
  const match = trimmed.match(/^([\d./-]+)\s*([a-zA-Z]+)?\s+(.+)$/);
  if (match) {
    const rawQty = match[1]?.trim() || "";
    const possibleUnit = match[2]?.trim() || "";
    const rest = match[3]?.trim() || "";
    if (units.includes(possibleUnit.toLowerCase())) {
      return { quantity: rawQty, unit: possibleUnit, name: singularizeWord(rest), completed: false };
    }
    return { quantity: rawQty, unit: "", name: singularizeWord(`${possibleUnit} ${rest}`.trim()), completed: false };
  }
  return { quantity: "", unit: "", name: singularizeWord(trimmed), completed: false };
}

const styles = {
  searchWrap: {
    position: "relative",
    width: "100%",
    maxWidth: 260,
  } as const,
  searchIcon: {
    position: "absolute",
    left: 14,
    top: "50%",
    transform: "translateY(-50%)",
    fontSize: 14,
    color: "#7A867D",
    pointerEvents: "none" as const,
  } as const,
  app: {
    padding: "18px 14px 36px",
    fontFamily: "Inter, system-ui, sans-serif",
    background: "linear-gradient(180deg, #F7F4EF 0%, #F1ECE5 100%)",
    minHeight: "100vh",
    color: "#24364B",
  } as const,
  shell: { maxWidth: 820, margin: "0 auto" } as const,
  headerCard: {
    position: "sticky",
    top: 10,
    zIndex: 10,
    background: "rgba(255,255,255,0.78)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    padding: 18,
    borderRadius: 22,
    marginBottom: 16,
    boxShadow: "0 10px 30px rgba(36,54,75,0.08)",
    border: "1px solid rgba(255,255,255,0.6)",
  } as const,
  card: {
    background: "rgba(255,255,255,0.92)",
    backdropFilter: "blur(8px)",
    WebkitBackdropFilter: "blur(8px)",
    padding: 18,
    borderRadius: 22,
    marginBottom: 16,
    boxShadow: "0 10px 30px rgba(36,54,75,0.08)",
    border: "1px solid rgba(255,255,255,0.6)",
    transition: "transform 180ms ease, opacity 180ms ease, box-shadow 180ms ease",
  } as const,
  dishCard: {
    background: "#FBF9F6",
    borderRadius: 18,
    padding: 16,
    border: "1px solid #ECE4D9",
    boxShadow: "0 2px 8px rgba(36,54,75,0.04)",
    marginBottom: 14,
    transition: "transform 180ms ease, box-shadow 180ms ease, opacity 180ms ease",
  } as const,
  input: {
    padding: 14,
    borderRadius: 14,
    border: "1px solid #DDD7CF",
    fontSize: 16,
    width: "100%",
    boxSizing: "border-box" as const,
    background: "#FFFDFC",
    color: "#24364B",
  } as const,
  button: {
    padding: "13px 15px",
    borderRadius: 14,
    border: "none",
    background: "#708E75",
    color: "white",
    cursor: "pointer",
    fontSize: 15,
    fontWeight: 700,
    boxShadow: "0 4px 10px rgba(112,142,117,0.24)",
  } as const,
  secondaryButton: {
    padding: "13px 15px",
    borderRadius: 14,
    border: "1px solid #DDD7CF",
    background: "#F3EEE7",
    cursor: "pointer",
    fontSize: 15,
    fontWeight: 700,
    color: "#24364B",
  } as const,
  dangerButton: {
    padding: "13px 15px",
    borderRadius: 14,
    border: "1px solid #E2CFCB",
    background: "#FAF1EF",
    color: "#8A4F46",
    cursor: "pointer",
    fontSize: 15,
    fontWeight: 700,
  } as const,
  actionWrap: {
    display: "flex",
    gap: 10,
    flexWrap: "wrap" as const,
    marginTop: 12,
  } as const,
  pill: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "6px 10px",
    borderRadius: 999,
    background: "#EEF4EE",
    color: "#47614B",
    fontSize: 13,
    fontWeight: 700,
  } as const,
  sectionTitle: {
    marginTop: 0,
    marginBottom: 12,
    fontSize: 24,
    lineHeight: 1.15,
    letterSpacing: "-0.02em",
  } as const,
};
  const [householdId, setHouseholdId] = useState(() => {
    const saved = localStorage.getItem(HOUSEHOLD_STORAGE_KEY);
    return saved?.trim() || DEFAULT_HOUSEHOLD_ID;
  });

  const [householdInput, setHouseholdInput] = useState(() => {
    const saved = localStorage.getItem(HOUSEHOLD_STORAGE_KEY);
    return saved?.trim() || DEFAULT_HOUSEHOLD_ID;
  });

  const [settingsOpen, setSettingsOpen] = useState(false);
export default function App() {
 const [dishes, setDishes] = useState<Dish[]>([]);

const [grocery, setGrocery] = useState<Ingredient[]>(() => {
  const savedHouseholdId = localStorage.getItem(HOUSEHOLD_STORAGE_KEY)?.trim() || DEFAULT_HOUSEHOLD_ID;
  const saved = localStorage.getItem(`grocery-${savedHouseholdId}`);
  if (!saved) return [];
  try {
    return mergeIngredientLists(sanitizeIngredients(JSON.parse(saved)));
  } catch {
    return [];
  }
});

  const [dishName, setDishName] = useState("");
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [bulkIngredientsText, setBulkIngredientsText] = useState("");
  const [manualIngredientsText, setManualIngredientsText] = useState("");
  const [dishSearch, setDishSearch] = useState("");
  const [ingredientSuggestions, setIngredientSuggestions] = useState<string[]>([]);
  const [manualSuggestions, setManualSuggestions] = useState<string[]>([]);
  const [selectedDish, setSelectedDish] = useState<Dish | null>(null);
  const [draggedKey, setDraggedKey] = useState<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const [dragOverCategory, setDragOverCategory] = useState<string | null>(null);
  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({});
  const [shoppingMode, setShoppingMode] = useState(false);
  const [selectedIngredientKeys, setSelectedIngredientKeys] = useState<string[]>([]);
  const [editingDishIndex, setEditingDishIndex] = useState<number | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerMode, setComposerMode] = useState<"menu" | "dish" | "grocery">("menu");
  const [animateKey, setAnimateKey] = useState(0);
  const manualTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const bulkIngredientsTextRef = useRef<HTMLTextAreaElement | null>(null);

  const sharedGroceryDocRef = useMemo(() => {
    return doc(db, "households", householdId);
  }, [householdId]);
useEffect(() => {
  setDoc(
    sharedGroceryDocRef,
    { householdId: householdId grocery: [], dishes: [] },
    { merge: true }
  ).catch((error) => {
    console.error("Failed to initialize household document:", error);
  });

  const unsubscribe = subscribeToSharedGroceryList();

  return () => unsubscribe();
}, }, [sharedGroceryDocRef, householdId]);
useEffect(() => {
  localStorage.setItem(HOUSEHOLD_STORAGE_KEY, householdId);
}, [householdId]);
useEffect(() => {
  localStorage.setItem(`grocery-${householdId}`, JSON.stringify(grocery));
}, [grocery, householdId]);
useEffect(() => {
  const timeout = window.setTimeout(() => {
    saveSharedGroceryList(false);
  }, 300);

  return () => window.clearTimeout(timeout);
}, [JSON.stringify(grocery)]);
useEffect(() => {
  const timeout = window.setTimeout(() => {
    saveSharedDishes(false);
  }, 300);

  return () => window.clearTimeout(timeout);
}, [JSON.stringify(dishes)]);
  useEffect(() => {
    if (!statusMessage) return;
    const t = window.setTimeout(() => setStatusMessage(""), 2200);
    return () => window.clearTimeout(t);
  }, [statusMessage]);

  function bumpAnimation() {
    setAnimateKey((v) => v + 1);
  }

function subscribeToSharedGroceryList() {
  return onSnapshot(
    sharedGroceryDocRef,
    (snapshot) => {
      if (!snapshot.exists()) {
        setGrocery([]);
        setDishes([]);
        return;
      }

      const data = snapshot.data();

      const nextGrocery = mergeIngredientLists(sanitizeIngredients(data.grocery));
      setGrocery(nextGrocery);

      const nextDishes = Array.isArray(data.dishes)
        ? data.dishes
            .map((dish) => {
              if (!dish || typeof dish !== "object") return null;
              const maybe = dish as Record<string, unknown>;
              const name = String(maybe.name ?? "").trim();
              if (!name) return null;
              return {
                name,
                ingredients: sanitizeIngredients(maybe.ingredients),
              };
            })
            .filter((dish): dish is Dish => dish !== null)
        : [];

      setDishes(nextDishes);
    },
    (error) => {
      console.error("Failed to subscribe to shared grocery list:", error);
    }
  );
}
async function saveSharedGroceryList(showMessage = true) {
  try {
    const cleanedGrocery = grocery.map((item) => ({
      quantity: item.quantity ?? "",
      unit: item.unit ?? "",
      name: item.name ?? "",
      completed: !!item.completed,
      ...(item.category ? { category: item.category } : {}),
      ...(item.aisle ? { aisle: item.aisle } : {}),
    }));

  await setDoc(
  sharedGroceryDocRef,
  {
   householdId: householdId
    grocery: cleanedGrocery,
  },
  { merge: true }
);

    if (showMessage) {
      setStatusMessage("Shared grocery list saved.");
    }
  } catch (error) {
    console.error("Failed to save shared grocery list:", error);

    if (showMessage) {
      if (error instanceof Error) {
        setStatusMessage(`Save failed: ${error.message}`);
      } else {
        setStatusMessage("Could not save shared grocery list.");
      }
    }
  }
}
async function saveSharedDishes(showMessage = true, nextDishes?: Dish[]) {
  try {
    const source = nextDishes ?? dishes;

    const cleanedDishes = source.map((dish) => ({
      name: String(dish.name ?? "").trim(),
      ingredients: sanitizeIngredients(dish.ingredients).map((item) => ({
        quantity: item.quantity ?? "",
        unit: item.unit ?? "",
        name: item.name ?? "",
        completed: !!item.completed,
        ...(item.category ? { category: item.category } : {}),
        ...(item.aisle ? { aisle: item.aisle } : {}),
      })),
    }));

    await setDoc(
      sharedGroceryDocRef,
      {
        householdId: householdId
        dishes: cleanedDishes,
      },
      { merge: true }
    );

    if (showMessage) {
      setStatusMessage("Shared dishes saved.");
    }
  } catch (error) {
    console.error("Failed to save shared dishes:", error);

    if (showMessage) {
      if (error instanceof Error) {
        setStatusMessage(`Dish save failed: ${error.message}`);
      } else {
        setStatusMessage("Could not save shared dishes.");
      }
    }
  }
}
  function resetDishForm() {
    setDishName("");
    setIngredients([]);
    setBulkIngredientsText("");
    setEditingDishIndex(null);
    setIngredientSuggestions([]);
  }
  function applyHouseholdIdChange() {
    const nextId = householdInput.trim();

    if (!nextId) {
      setStatusMessage("Household ID cannot be empty.");
      return;
    }

    if (nextId === householdId) {
      setSettingsOpen(false);
      setStatusMessage("Already using this household.");
      return;
    }

    setHouseholdId(nextId);
    setGrocery([]);
    setDishes([]);
    setSelectedDish(null);
    setSelectedIngredientKeys([]);
    setCollapsedCategories({});
    setSettingsOpen(false);
    setStatusMessage("Household updated.");
  }
  function vibrate(ms = 12) {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate(ms);
    }
  }

  function addParsedIngredients() {
    const lines = bulkIngredientsText.split("\n").map((line) => line.trim()).filter(Boolean);
    if (lines.length === 0) return;
    const parsed = lines.map((line) => parseIngredientLine(line)).filter((item): item is Ingredient => item !== null);
    setIngredients([...ingredients, ...parsed]);
    setBulkIngredientsText("");
    setIngredientSuggestions([]);
    setStatusMessage("Ingredients added.");
  }

  function handleDishPasteInput(value: string) {
    setBulkIngredientsText(value);
    setIngredientSuggestions(buildSuggestions(value));
  }

  function handleDishPasteEvent() {
    window.setTimeout(() => {
      const value = bulkIngredientsTextRef.current?.value ?? "";
      const lines = value.split("\n").map((line) => line.trim()).filter(Boolean);
      if (lines.length < 2) return;
      const parsed = lines.map((line) => parseIngredientLine(line)).filter((item): item is Ingredient => item !== null);
      setIngredients((current) => [...current, ...parsed]);
      setBulkIngredientsText("");
      setIngredientSuggestions([]);
      setStatusMessage("Ingredients added.");
    }, 0);
  }

  function removeIngredientFromForm(index: number) {
    setIngredients(ingredients.filter((_, i) => i !== index));
  }

function saveDish() {
  if (!dishName.trim() || ingredients.length === 0) return;

  const dishToSave: Dish = { name: dishName.trim(), ingredients };
  let nextDishes: Dish[];

  if (editingDishIndex !== null) {
    nextDishes = [...dishes];
    nextDishes[editingDishIndex] = dishToSave;
  } else {
    nextDishes = [...dishes, dishToSave];
  }

  setDishes(nextDishes);
  saveSharedDishes(false, nextDishes);

  const wasEditing = editingDishIndex !== null;
  resetDishForm();
  setComposerOpen(false);
  setComposerMode("menu");
  setStatusMessage(wasEditing ? "Dish updated." : "Dish saved.");
  bumpAnimation();
  vibrate();
}

  function editDish(index: number) {
    const dish = dishes[index];
    setDishName(dish.name);
    setIngredients(dish.ingredients.map((ing) => ({ ...ing, completed: false })));
    setEditingDishIndex(index);
    setBulkIngredientsText("");
    setIngredientSuggestions([]);
    setComposerMode("dish");
    setComposerOpen(true);
  }

function deleteDish(index: number) {
  const nextDishes = dishes.filter((_, i) => i !== index);
  setDishes(nextDishes);
  saveSharedDishes(false, nextDishes);

  if (editingDishIndex === index) resetDishForm();
  setStatusMessage("Dish deleted.");
  bumpAnimation();
}

  function addParsedManualItems() {
    const lines = manualIngredientsText.split("\n").map((line) => line.trim()).filter(Boolean);
    if (lines.length === 0) return;
    const parsed = lines
      .map((line) => parseIngredientLine(line))
      .filter((item): item is Ingredient => item !== null)
      .map((item) => ({ ...item, completed: false }));
    setGrocery((current) => mergeIngredientLists([...current, ...parsed]));
    setManualIngredientsText("");
    setManualSuggestions([]);
    setStatusMessage("Grocery items added.");
    manualTextareaRef.current?.focus();
    setComposerOpen(false);
    setComposerMode("menu");
    bumpAnimation();
    vibrate();
  }

  function handleManualPasteInput(value: string) {
    setManualIngredientsText(value);
    setManualSuggestions(buildSuggestions(value));
  }

  function handleManualPasteEvent() {
    window.setTimeout(() => {
      const value = manualTextareaRef.current?.value ?? "";
      const lines = value.split("\n").map((line) => line.trim()).filter(Boolean);
      if (lines.length < 2) return;
      const parsed = lines
        .map((line) => parseIngredientLine(line))
        .filter((item): item is Ingredient => item !== null)
        .map((item) => ({ ...item, completed: false }));
      setGrocery((current) => mergeIngredientLists([...current, ...parsed]));
      setManualIngredientsText("");
      setManualSuggestions([]);
      setStatusMessage("Grocery items added.");
      window.setTimeout(() => manualTextareaRef.current?.focus(), 0);
      setComposerOpen(false);
      setComposerMode("menu");
      bumpAnimation();
      vibrate();
    }, 0);
  }

  function openDishSelector(dish: Dish) {
    setSelectedDish(dish);
    setSelectedIngredientKeys(dish.ingredients.map((ing) => exactIngredientKey(ing)));
  }

  function toggleIngredientSelection(item: Ingredient) {
    const key = exactIngredientKey(item);
    setSelectedIngredientKeys((current) =>
      current.includes(key) ? current.filter((k) => k !== key) : [...current, key]
    );
  }

  function confirmAddToGrocery() {
    if (!selectedDish) return;
    const selectedItems = selectedDish.ingredients
      .filter((item) => selectedIngredientKeys.includes(exactIngredientKey(item)))
      .map((item) => ({ ...item, completed: false }));
    setGrocery((current) => mergeIngredientLists([...current, ...selectedItems]));
    setSelectedDish(null);
    setSelectedIngredientKeys([]);
    setStatusMessage("Ingredients added to grocery list.");
    bumpAnimation();
    vibrate();
  }

  function addEntireDishToGrocery(dish: Dish) {
    const allItems = dish.ingredients.map((item) => ({ ...item, completed: false }));
    setGrocery((current) => mergeIngredientLists([...current, ...allItems]));
    setStatusMessage("Dish added to grocery list.");
    bumpAnimation();
    vibrate();
  }

  function toggleGroceryComplete(target: Ingredient) {
    setGrocery((current) => {
      const updated = current.map((item) =>
        ingredientGroupKey(item) === ingredientGroupKey(target)
          ? { ...item, completed: !item.completed }
          : item
      );
      return mergeIngredientLists(updated);
    });
    bumpAnimation();
    vibrate();
  }

  function clearCompletedItems() {
    setGrocery((current) => current.filter((item) => !item.completed));
    setStatusMessage("Completed items cleared.");
    bumpAnimation();
  }

  function toggleCategoryCollapsed(category: string) {
    setCollapsedCategories((current) => ({
      ...current,
      [category]: !current[category],
    }));
  }

  function toggleShoppingMode() {
    setShoppingMode((current) => !current);
    setStatusMessage((current) => (current ? "" : "Shopping mode on."));
    bumpAnimation();
    vibrate();
  }

  function getItemCategory(item: Ingredient) {
    return item.category || getCategory(item.name);
  }

  function moveItemToPosition(targetKey: string, destinationCategory: string, beforeKey?: string | null) {
    setGrocery((current) => {
      const sourceIndex = current.findIndex((item) => ingredientGroupKey(item) === targetKey);
      if (sourceIndex < 0) return current;

      const movingItem = {
        ...current[sourceIndex],
        category: destinationCategory,
      };

      const remaining = current.filter((_, index) => index !== sourceIndex);

      let insertIndex = remaining.length;
      if (beforeKey) {
        const foundIndex = remaining.findIndex((item) => ingredientGroupKey(item) === beforeKey);
        if (foundIndex >= 0) insertIndex = foundIndex;
      } else {
        const lastIndexInCategory = [...remaining]
          .map((item, index) => ({ item, index }))
          .filter(({ item }) => !item.completed && getItemCategory(item) === destinationCategory)
          .map(({ index }) => index)
          .pop();
        if (typeof lastIndexInCategory === "number") insertIndex = lastIndexInCategory + 1;
      }

      const next = [...remaining];
      next.splice(insertIndex, 0, movingItem);
      return next;
    });

    setDraggedKey(null);
    setDragOverKey(null);
    setDragOverCategory(null);
    setStatusMessage("Grocery list reordered.");
    bumpAnimation();
    vibrate();
  }

  function removeGroceryItem(target: Ingredient) {
    setGrocery((current) => current.filter((item) => ingredientGroupKey(item) !== ingredientGroupKey(target)));
    setStatusMessage("Item removed.");
    bumpAnimation();
    vibrate();
  }

  const groupedGrocery = useMemo(() => {
    const activeItems = grocery.filter((item) => !item.completed);
    const groups: Record<string, Ingredient[]> = {};
    activeItems.forEach((item) => {
      const category = getItemCategory(item);
      if (!groups[category]) groups[category] = [];
      groups[category].push(item);
    });
    const order = ["Produce", "Dairy", "Meat", "Pantry", "Bakery", "Other"];
    const known = order.filter((cat) => groups[cat]?.length).map((cat) => ({ category: cat, items: groups[cat] }));
    const custom = Object.keys(groups)
      .filter((cat) => !order.includes(cat))
      .sort()
      .map((cat) => ({ category: cat, items: groups[cat] }));
    return [...known, ...custom];
  }, [grocery, animateKey]);

  const completedItems = useMemo(() => mergeIngredientLists(grocery.filter((item) => item.completed)), [grocery, animateKey]);

  const totalVisibleItems = groupedGrocery.reduce((sum, group) => sum + group.items.length, 0) + completedItems.length;
  const completedCount = completedItems.length;
  const remainingCount = groupedGrocery.reduce((sum, group) => sum + group.items.length, 0);
  const progressPercent = totalVisibleItems > 0 ? Math.round((completedCount / totalVisibleItems) * 100) : 0;

  const filteredDishes = useMemo(() => {
    const q = dishSearch.trim().toLowerCase();
    if (!q) return dishes;
    return dishes.filter((dish) => {
      const inName = dish.name.toLowerCase().includes(q);
      const inIngredients = dish.ingredients.some((ing) => ingredientLabel(ing).toLowerCase().includes(q));
      return inName || inIngredients;
    });
  }, [dishes, dishSearch]);

  return (
    <div style={styles.app}>
      <div style={styles.shell}>
        <div style={styles.headerCard}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
            <div>
              <div style={styles.pill}>Minimal • Fast • Grocery-first</div>
              <h1 style={{ margin: "10px 0 6px", fontSize: 38, lineHeight: 1.02, letterSpacing: "-0.03em" }}>Smart Grocery Planner</h1>
              <div>
  <p style={{ margin: 0, color: "#5C6D63", fontSize: 16 }}>Build dishes quickly, then shop from one clear grocery list.</p>
  <p style={{ margin: "8px 0 0", color: "#7A867D", fontSize: 13 }}>
    Household: <strong>{householdId}</strong>
  </p>
</div>
            </div>
           <button
  style={{
    ...styles.button,
    minWidth: 58,
    minHeight: 58,
    borderRadius: 18,
    fontSize: 28,
    lineHeight: 1,
    padding: 0,
    display: "grid",
    placeItems: "center",
  }}
  onClick={() => {
    setComposerMode("menu");
    setComposerOpen(true);
  }}
  aria-label="Open add menu"
  title="Add"
  onMouseEnter={(e) => {
    e.currentTarget.style.transform = "translateY(-1px) scale(1.03)";
    e.currentTarget.style.boxShadow = "0 10px 24px rgba(112,142,117,0.30)";
  }}
  onMouseLeave={(e) => {
    e.currentTarget.style.transform = "translateY(0) scale(1)";
    e.currentTarget.style.boxShadow = "0 4px 10px rgba(112,142,117,0.24)";
  }}
>
  +
</button>
          </div>
        </div>

        {statusMessage ? (
          <div style={{ ...styles.card, padding: 14, marginBottom: 12, background: "#EEF5EE" }}>{statusMessage}</div>
        ) : null}

        <div style={{ ...styles.card, overflow: "visible" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div>
              <h2 style={{ ...styles.sectionTitle, marginBottom: 6 }}>{shoppingMode ? "🛒 Shopping Mode" : "🛒 Grocery List"}</h2>
              <div style={{ color: "#66756C", fontSize: shoppingMode ? 16 : 15, fontWeight: 600 }}>
                {totalVisibleItems === 0
                  ? "No items yet"
                  : completedCount > 0
                    ? `${completedCount} / ${totalVisibleItems} items completed`
                    : `${remainingCount} items remaining`}
              </div>
              {totalVisibleItems > 0 && (
                <div style={{ marginTop: 10, width: shoppingMode ? 260 : 220, maxWidth: "100%", height: shoppingMode ? 10 : 8, background: "#E6E0D8", borderRadius: 999, overflow: "hidden" }}>
                  <div style={{ width: `${progressPercent}%`, height: "100%", background: "#708E75", transition: "width 220ms ease" }} />
                </div>
              )}
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button style={shoppingMode ? styles.button : styles.secondaryButton} onClick={toggleShoppingMode}>
                {shoppingMode ? "Exit Shopping" : "Start Shopping"}
              </button>
              {completedItems.length > 0 ? <button style={styles.secondaryButton} onClick={clearCompletedItems}>Clear Completed</button> : null}
            </div>
          </div>

          {groupedGrocery.length === 0 && completedItems.length === 0 ? (
            <div style={{ padding: "6px 0 2px" }}>
              <p style={{ margin: "0 0 8px", fontSize: 18, fontWeight: 700 }}>Your grocery list is empty.</p>
              <p style={{ margin: 0, color: "#66756C" }}>Add a dish or paste grocery items to get started.</p>
            </div>
          ) : null}

          {groupedGrocery.map((group) => (
            <div
              key={group.category}
              style={{ marginBottom: 24 }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOverCategory(group.category);
                setDragOverKey(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragOverKey) return;
                if (draggedKey) moveItemToPosition(draggedKey, group.category, null);
              }}
            >
              <div style={{ position: "sticky", top: 96, zIndex: 6, padding: "6px 0 10px", marginBottom: 4 }}>
                <button
                  type="button"
                  onClick={() => toggleCategoryCollapsed(group.category)}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    minHeight: 32,
                    padding: "6px 12px",
                    borderRadius: 999,
                    background: "rgba(246,243,238,0.96)",
                    backdropFilter: "blur(8px)",
                    WebkitBackdropFilter: "blur(8px)",
                    border: "1px solid rgba(221,215,207,0.9)",
                    boxShadow: "0 4px 14px rgba(36,54,75,0.06)",
                    cursor: "pointer",
                    color: "#24364B",
                  }}
                >
                  <span style={{ fontSize: 14, width: 14, textAlign: "center" }}>{collapsedCategories[group.category] ? "▸" : "▾"}</span>
                  <h3 style={{ margin: 0, fontSize: 16, lineHeight: 1 }}>{getCategoryIcon(group.category)} {group.category}</h3>
                </button>
              </div>
              {!collapsedCategories[group.category] && (
                <ul style={{ listStyle: "none", paddingLeft: 0, margin: 0 }}>
                  {group.items.map((item, i) => {
                    const itemKey = ingredientGroupKey(item);
                    const isDragged = draggedKey === itemKey;
                    const isTarget = dragOverKey === itemKey;
                    return (
                      <li
                        key={i}
                        draggable={!shoppingMode}
                        onDragStart={() => {
                          if (shoppingMode) return;
                          setDraggedKey(itemKey);
                          setDragOverCategory(group.category);
                        }}
                        onDragEnd={() => {
                          setDraggedKey(null);
                          setDragOverKey(null);
                          setDragOverCategory(null);
                        }}
                        onDragOver={(e) => {
                          if (shoppingMode) return;
                          e.preventDefault();
                          e.stopPropagation();
                          setDragOverKey(itemKey);
                          setDragOverCategory(group.category);
                        }}
                        onDrop={(e) => {
                          if (shoppingMode) return;
                          e.preventDefault();
                          e.stopPropagation();
                          if (draggedKey) moveItemToPosition(draggedKey, group.category, itemKey);
                        }}
                        style={{
                          marginBottom: shoppingMode ? 14 : 12,
                          transition: "transform 180ms ease, opacity 180ms ease",
                          opacity: isDragged ? 0.45 : 1,
                          transform: isTarget ? "translateY(-2px)" : "translateY(0)",
                        }}
                      >
                        <label
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 12,
                            background: dragOverCategory === group.category && !dragOverKey ? "#F5F0E8" : "#FBF9F6",
                            border: isTarget ? "1px solid #708E75" : "1px solid #EDE6DC",
                            borderRadius: shoppingMode ? 18 : 16,
                            padding: shoppingMode ? "16px 16px" : "12px 14px",
                            boxShadow: isTarget ? "0 6px 16px rgba(112,142,117,0.14)" : "none",
                            cursor: shoppingMode ? "pointer" : "grab",
                          }}
                          onTouchStart={(e) => {
                            const startX = e.touches[0]?.clientX ?? 0;
                            (e.currentTarget as HTMLElement).dataset.startX = String(startX);
                          }}
                          onTouchEnd={(e) => {
                            const startX = Number((e.currentTarget as HTMLElement).dataset.startX || 0);
                            const endX = e.changedTouches[0]?.clientX ?? 0;
                            const delta = endX - startX;
                            if (delta > 60) toggleGroceryComplete(item);
                            if (!shoppingMode && delta < -60) removeGroceryItem(item);
                          }}
                        >
                          {!shoppingMode ? <span style={{ fontSize: 18, color: "#9AA59D", cursor: "grab", userSelect: "none" }}>⋮⋮</span> : null}
                          <input type="checkbox" checked={!!item.completed} onChange={() => toggleGroceryComplete(item)} style={{ width: shoppingMode ? 26 : 22, height: shoppingMode ? 26 : 22 }} />
                          <span style={{ fontSize: shoppingMode ? 22 : 18, flex: 1, fontWeight: shoppingMode ? 600 : 400 }}>{ingredientLabel(item)}</span>
                          {!shoppingMode ? <span style={{ fontSize: 12, color: "#9AA59D" }}>Drag or swipe</span> : null}
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ))}

          {completedItems.length > 0 && (
            <div style={{ marginTop: 28 }}>
              <h3 style={{ color: "#6B7A6B", marginBottom: 10, fontSize: 18 }}>✅ Completed</h3>
              <ul style={{ listStyle: "none", paddingLeft: 0, margin: 0 }}>
                {completedItems.map((item, i) => (
                  <li key={i} style={{ marginBottom: shoppingMode ? 14 : 12, opacity: 0.68, transition: "transform 180ms ease, opacity 180ms ease" }}>
                    <label
                      style={{ display: "flex", alignItems: "center", gap: 12, background: "#F8F5F1", border: "1px solid #ECE4DA", borderRadius: shoppingMode ? 18 : 16, padding: shoppingMode ? "16px 16px" : "12px 14px" }}
                      onTouchStart={(e) => {
                        const startX = e.touches[0]?.clientX ?? 0;
                        (e.currentTarget as HTMLElement).dataset.startX = String(startX);
                      }}
                      onTouchEnd={(e) => {
                        const startX = Number((e.currentTarget as HTMLElement).dataset.startX || 0);
                        const endX = e.changedTouches[0]?.clientX ?? 0;
                        const delta = endX - startX;
                        if (Math.abs(delta) > 60 && delta > 0) toggleGroceryComplete(item);
                        if (!shoppingMode && delta < -60) removeGroceryItem(item);
                      }}
                    >
                      <input type="checkbox" checked={!!item.completed} onChange={() => toggleGroceryComplete(item)} style={{ width: shoppingMode ? 26 : 22, height: shoppingMode ? 26 : 22 }} />
                      <span style={{ fontSize: shoppingMode ? 22 : 18, textDecoration: "line-through", flex: 1, fontWeight: shoppingMode ? 600 : 400 }}>{ingredientLabel(item)}</span>
                      {!shoppingMode ? <span style={{ fontSize: 12, color: "#9AA59D" }}>Swipe left to remove</span> : null}
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div style={styles.card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap", marginBottom: 6 }}>
            <h2 style={{ ...styles.sectionTitle, marginBottom: 2 }}>Saved Dishes</h2>
            <div style={styles.searchWrap}>
              <span style={styles.searchIcon}>⌕</span>
              <input
                style={{ ...styles.input, maxWidth: 260, padding: "12px 12px 12px 38px", height: 44 }}
                placeholder="Search dishes"
                value={dishSearch}
                onChange={(e) => setDishSearch(e.target.value)}
              />
            </div>
          </div>

          {filteredDishes.length === 0 ? (
            <div style={{ padding: "6px 0 2px" }}>
              <p style={{ margin: "0 0 8px", fontSize: 18, fontWeight: 700 }}>No dishes yet.</p>
              <p style={{ margin: 0, color: "#66756C" }}>Create your first dish to build grocery lists faster.</p>
            </div>
          ) : null}

          {filteredDishes.map((dish, i) => {
            const originalIndex = dishes.findIndex((d) => d === dish);
            return (
              <div
                key={i}
                style={styles.dishCard}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = "translateY(-2px)";
                  e.currentTarget.style.boxShadow = "0 8px 18px rgba(36,54,75,0.08)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = "translateY(0)";
                  e.currentTarget.style.boxShadow = "0 2px 8px rgba(36,54,75,0.04)";
                }}
              >
                <strong style={{ fontSize: 24, lineHeight: 1.1 }}>{dish.name}</strong>
                <div style={{ marginTop: 10, display: "grid", gap: 6, color: "#51625A" }}>
                  {dish.ingredients.slice(0, 3).map((ing, idx) => <div key={idx}>{ingredientLabel(ing)}</div>)}
                  {dish.ingredients.length > 3 && (
                    <div style={{ color: "#6B7A6B", fontSize: 14, fontWeight: 700 }}>+{dish.ingredients.length - 3} more ingredients</div>
                  )}
                </div>
                <div style={{ ...styles.actionWrap, marginTop: 14 }}>
                  <button style={{ ...styles.button, flex: 1 }} onClick={() => addEntireDishToGrocery(dish)}>Add All</button>
                  <button style={{ ...styles.secondaryButton, flex: 1 }} onClick={() => openDishSelector(dish)}>Select Ingredients</button>
                </div>
                <div style={{ ...styles.actionWrap, marginTop: 10 }}>
                  <button style={{ ...styles.secondaryButton, flex: 1 }} onClick={() => editDish(originalIndex)}>Edit</button>
                  <button style={{ ...styles.dangerButton, flex: 1 }} onClick={() => deleteDish(originalIndex)}>Delete</button>
                </div>
              </div>
            );
          })}
        </div>

        <div style={styles.card}>
          <h2 style={styles.sectionTitle}>Quick Add Grocery Items</h2>
          <p style={{ marginBottom: 8, fontWeight: 600 }}>Paste items one per line</p>
          <textarea
            ref={manualTextareaRef}
            value={manualIngredientsText}
            onChange={(e) => handleManualPasteInput(e.target.value)}
            onPaste={handleManualPasteEvent}
            placeholder={`8 apples\n3 milk\n1 loaf bread\n2 cans beans`}
            style={{ ...styles.input, width: "100%", minHeight: 120, resize: "vertical" }}
          />
          {manualSuggestions.length > 0 && (
            <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
              {manualSuggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  style={{ ...styles.secondaryButton, padding: "8px 10px", fontSize: 13 }}
                  onClick={() => {
                    const lines = manualIngredientsText.split("\n");
                    lines[lines.length - 1] = suggestion;
                    setManualIngredientsText(lines.join("\n"));
                    setManualSuggestions([]);
                  }}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          )}
          <button style={{ ...styles.button, marginTop: 10, width: "100%" }} onClick={addParsedManualItems}>Add Grocery Items</button>
        </div>
        {settingsOpen && (
          <div style={{ position: "fixed", inset: 0, background: "rgba(19,25,31,0.28)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)", display: "flex", alignItems: "flex-end", justifyContent: "center", padding: 12, zIndex: 22 }}>
            <div style={{ ...styles.card, width: "100%", maxWidth: 560, marginBottom: 0, borderBottomLeftRadius: 26, borderBottomRightRadius: 26 }}>
              <h2 style={{ ...styles.sectionTitle, marginBottom: 8 }}>Household Settings</h2>
              <p style={{ marginTop: 0, color: "#65756C" }}>
                Use the same household ID on multiple devices to share dishes and grocery lists.
              </p>

              <label style={{ display: "block", marginBottom: 8, fontWeight: 600 }}>Household ID</label>
              <input
                style={styles.input}
                value={householdInput}
                onChange={(e) => setHouseholdInput(e.target.value)}
                placeholder="Enter household ID"
              />

              <div style={{ marginTop: 12, color: "#7A867D", fontSize: 13 }}>
                Current household: <strong>{householdId}</strong>
              </div>

              <div style={{ ...styles.actionWrap, marginTop: 18 }}>
                <button style={{ ...styles.button, flex: 1 }} onClick={applyHouseholdIdChange}>
                  Save Household
                </button>
                <button style={{ ...styles.secondaryButton, flex: 1 }} onClick={() => setSettingsOpen(false)}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
        {composerOpen && (
          <div style={{ position: "fixed", inset: 0, background: "rgba(19,25,31,0.28)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)", display: "flex", alignItems: "flex-end", justifyContent: "center", padding: 12, zIndex: 20 }}>
            <div style={{ ...styles.card, width: "100%", maxWidth: 560, marginBottom: 0, borderBottomLeftRadius: 26, borderBottomRightRadius: 26, transform: "translateY(0)", transition: "transform 220ms ease, opacity 220ms ease" }}>
              {composerMode === "menu" ? (
                <div>
                  <h2 style={{ ...styles.sectionTitle, marginBottom: 8 }}>Add</h2>
                  <p style={{ marginTop: 0, color: "#65756C" }}>Choose what you want to add.</p>
                  <div style={styles.actionWrap}>
                    <button style={{ ...styles.button, flex: 1 }} onClick={() => setComposerMode("dish")}>Add Dish</button>
                    <button style={{ ...styles.secondaryButton, flex: 1 }} onClick={() => setComposerMode("grocery")}>Add Grocery Items</button>
                  </div>
                  <button style={{ ...styles.secondaryButton, width: "100%", marginTop: 10 }} onClick={() => setComposerOpen(false)}>Close</button>
                </div>
              ) : null}

              {composerMode === "dish" ? (
                <div>
                  <h2 style={{ ...styles.sectionTitle, marginBottom: 8 }}>{editingDishIndex !== null ? "Edit Dish" : "Create Dish"}</h2>
                  <input style={styles.input} placeholder="Dish name" value={dishName} onChange={(e) => setDishName(e.target.value)} />
                  <div style={{ marginTop: 14 }}>
                    <p style={{ marginBottom: 8, fontWeight: 600 }}>Paste ingredients one per line</p>
                    <textarea
                      ref={bulkIngredientsTextRef}
                      value={bulkIngredientsText}
                      onChange={(e) => handleDishPasteInput(e.target.value)}
                      onPaste={handleDishPasteEvent}
                      placeholder={`500 g pasta\n2 tbsp olive oil\n3 cloves garlic\n1 can tomatoes`}
                      style={{ ...styles.input, width: "100%", minHeight: 140, resize: "vertical" }}
                    />
                    {ingredientSuggestions.length > 0 && (
                      <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {ingredientSuggestions.map((suggestion) => (
                          <button
                            key={suggestion}
                            type="button"
                            style={{ ...styles.secondaryButton, padding: "8px 10px", fontSize: 13 }}
                            onClick={() => {
                              const lines = bulkIngredientsText.split("\n");
                              lines[lines.length - 1] = suggestion;
                              setBulkIngredientsText(lines.join("\n"));
                              setIngredientSuggestions([]);
                            }}
                          >
                            {suggestion}
                          </button>
                        ))}
                      </div>
                    )}
                    <button style={{ ...styles.secondaryButton, marginTop: 10, width: "100%" }} onClick={addParsedIngredients}>Add Ingredients</button>
                  </div>
                  <ul style={{ marginTop: 18, paddingLeft: 18 }}>
                    {ingredients.map((ing, i) => (
                      <li key={i} style={{ marginBottom: 10 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                          <span>{ingredientLabel(ing)}</span>
                          <button style={{ ...styles.secondaryButton, padding: "6px 10px" }} onClick={() => removeIngredientFromForm(i)}>Remove</button>
                        </div>
                      </li>
                    ))}
                  </ul>
                  <div style={styles.actionWrap}>
                    <button style={{ ...styles.button, flex: 1 }} onClick={saveDish}>{editingDishIndex !== null ? "Update Dish" : "Save Dish"}</button>
                    <button style={{ ...styles.secondaryButton, flex: 1 }} onClick={() => { resetDishForm(); setComposerOpen(false); setComposerMode("menu"); }}>Cancel</button>
                  </div>
                </div>
              ) : null}

              {composerMode === "grocery" ? (
                <div>
                  <h2 style={{ ...styles.sectionTitle, marginBottom: 8 }}>Add Grocery Items</h2>
                  <p style={{ marginTop: 0, color: "#65756C" }}>Paste items one per line.</p>
                  <textarea
                    ref={manualTextareaRef}
                    value={manualIngredientsText}
                    onChange={(e) => handleManualPasteInput(e.target.value)}
                    onPaste={handleManualPasteEvent}
                    placeholder={`8 apples\n3 milk\n1 loaf bread\n2 cans beans`}
                    style={{ ...styles.input, width: "100%", minHeight: 120, resize: "vertical" }}
                  />
                  {manualSuggestions.length > 0 && (
                    <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {manualSuggestions.map((suggestion) => (
                        <button
                          key={suggestion}
                          type="button"
                          style={{ ...styles.secondaryButton, padding: "8px 10px", fontSize: 13 }}
                          onClick={() => {
                            const lines = manualIngredientsText.split("\n");
                            lines[lines.length - 1] = suggestion;
                            setManualIngredientsText(lines.join("\n"));
                            setManualSuggestions([]);
                          }}
                        >
                          {suggestion}
                        </button>
                      ))}
                    </div>
                  )}
                  <div style={styles.actionWrap}>
                    <button style={{ ...styles.button, flex: 1 }} onClick={addParsedManualItems}>Add Grocery Items</button>
                    <button style={{ ...styles.secondaryButton, flex: 1 }} onClick={() => setComposerOpen(false)}>Cancel</button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        )}

        {selectedDish && (
          <div style={{ position: "fixed", inset: 0, background: "rgba(19,25,31,0.28)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)", display: "flex", alignItems: "flex-end", justifyContent: "center", padding: 12, zIndex: 25 }}>
            <div style={{ ...styles.card, width: "100%", maxWidth: 560, marginBottom: 0, borderBottomLeftRadius: 26, borderBottomRightRadius: 26 }}>
              <h2 style={{ ...styles.sectionTitle, marginBottom: 8 }}>Select Ingredients to Add</h2>
              <p style={{ marginTop: 0, color: "#65756C" }}>{selectedDish.name}</p>
              <div style={{ display: "grid", gap: 10 }}>
                {selectedDish.ingredients.map((item, i) => {
                  const checked = selectedIngredientKeys.includes(exactIngredientKey(item));
                  return (
                    <label key={i} style={{ display: "flex", alignItems: "center", gap: 12, background: "#FBF9F6", border: "1px solid #EDE6DC", borderRadius: 16, padding: "12px 14px" }}>
                      <input type="checkbox" checked={checked} onChange={() => toggleIngredientSelection(item)} style={{ width: 22, height: 22 }} />
                      <span>{ingredientLabel(item)}</span>
                    </label>
                  );
                })}
              </div>
              <div style={{ ...styles.actionWrap, marginTop: 18 }}>
                <button style={{ ...styles.button, flex: 1 }} onClick={confirmAddToGrocery}>Add Selected</button>
                <button style={{ ...styles.secondaryButton, flex: 1 }} onClick={() => setSelectedDish(null)}>Cancel</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}