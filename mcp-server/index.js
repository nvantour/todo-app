import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import admin from 'firebase-admin';
import { readFileSync } from 'fs';

// ─── Firebase Admin initialisatie ───────────────────────────────

const credPath = process.env.FIREBASE_CREDENTIALS_PATH;
if (!credPath) {
  console.error('FIREBASE_CREDENTIALS_PATH environment variable is vereist');
  process.exit(1);
}

const serviceAccount = JSON.parse(readFileSync(credPath, 'utf-8'));

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const db = admin.firestore();

// ─── Tool definities ────────────────────────────────────────────

const tools = [
  {
    name: 'list_todos',
    description: 'Toon alle open todo\'s. Optioneel filteren op categorie of status.',
    inputSchema: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          description: 'Filter op categorienaam (bijv. "Transavia", "Wehkamp")',
        },
        include_done: {
          type: 'boolean',
          description: 'Ook afgeronde todo\'s tonen (standaard: false)',
        },
      },
    },
  },
  {
    name: 'add_todo',
    description: 'Voeg een nieuwe todo toe. Categorie wordt automatisch gedetecteerd op basis van keywords.',
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Titel van de todo (verplicht)',
        },
        category: {
          type: 'string',
          description: 'Categorienaam (optioneel — wordt automatisch gedetecteerd als niet opgegeven)',
        },
        due_date: {
          type: 'string',
          description: 'Vervaldatum in YYYY-MM-DD formaat (optioneel)',
        },
        time_estimate: {
          type: 'number',
          description: 'Geschatte tijd in minuten (optioneel, bijv. 30, 60, 120)',
        },
      },
      required: ['title'],
    },
  },
  {
    name: 'complete_todo',
    description: 'Markeer een todo als afgerond.',
    inputSchema: {
      type: 'object',
      properties: {
        todo_id: {
          type: 'string',
          description: 'Het ID van de todo om af te vinken',
        },
      },
      required: ['todo_id'],
    },
  },
  {
    name: 'reopen_todo',
    description: 'Markeer een afgeronde todo als weer open.',
    inputSchema: {
      type: 'object',
      properties: {
        todo_id: {
          type: 'string',
          description: 'Het ID van de todo om te heropenen',
        },
      },
      required: ['todo_id'],
    },
  },
  {
    name: 'update_todo',
    description: 'Wijzig een bestaande todo (titel, categorie, due date, tijdsinschatting).',
    inputSchema: {
      type: 'object',
      properties: {
        todo_id: {
          type: 'string',
          description: 'Het ID van de todo om te wijzigen',
        },
        title: {
          type: 'string',
          description: 'Nieuwe titel (optioneel)',
        },
        category: {
          type: 'string',
          description: 'Nieuwe categorienaam (optioneel)',
        },
        due_date: {
          type: 'string',
          description: 'Nieuwe vervaldatum in YYYY-MM-DD formaat, of "none" om te verwijderen (optioneel)',
        },
        time_estimate: {
          type: 'number',
          description: 'Nieuwe tijdsinschatting in minuten, of 0 om te verwijderen (optioneel)',
        },
      },
      required: ['todo_id'],
    },
  },
  {
    name: 'delete_todo',
    description: 'Verwijder een todo permanent.',
    inputSchema: {
      type: 'object',
      properties: {
        todo_id: {
          type: 'string',
          description: 'Het ID van de todo om te verwijderen',
        },
      },
      required: ['todo_id'],
    },
  },
  {
    name: 'list_categories',
    description: 'Toon alle categorieën met hun kleuren en keywords.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

// ─── Helpers ────────────────────────────────────────────────────

async function getCategories() {
  const snap = await db.collection('categories').orderBy('order').get();
  return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

function detectCategory(title, categories) {
  const lower = title.toLowerCase();
  for (const cat of categories) {
    const keywords = cat.keywords || [];
    if (keywords.some(kw => lower.includes(kw.toLowerCase()))) {
      return cat;
    }
  }
  return null;
}

function formatDate(firebaseTimestamp) {
  if (!firebaseTimestamp) return null;
  const date = firebaseTimestamp.toDate ? firebaseTimestamp.toDate() : new Date(firebaseTimestamp);
  return date.toISOString().split('T')[0];
}

function formatTodo(doc, categories) {
  const data = doc.data();
  const category = categories.find(c => c.id === data.categoryId);
  return {
    id: doc.id,
    title: data.title,
    done: data.done || false,
    category: category?.name || null,
    dueDate: formatDate(data.dueDate),
    timeEstimate: data.timeEstimate || null,
    calendarEventId: data.calendarEventId || null,
    createdAt: formatDate(data.createdAt),
  };
}

// ─── Tool handlers ──────────────────────────────────────────────

async function handleListTodos(args) {
  const categories = await getCategories();
  let query = db.collection('todos').orderBy('createdAt', 'desc');

  const snap = await query.get();
  let todos = snap.docs.map(doc => formatTodo(doc, categories));

  // Filter op done status
  if (!args.include_done) {
    todos = todos.filter(t => !t.done);
  }

  // Filter op categorie (naam)
  if (args.category) {
    const catLower = args.category.toLowerCase();
    todos = todos.filter(t => t.category && t.category.toLowerCase() === catLower);
  }

  // Groepeer op categorie
  const grouped = {};
  for (const todo of todos) {
    const cat = todo.category || 'Zonder categorie';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(todo);
  }

  return {
    total: todos.length,
    todos: grouped,
  };
}

async function handleAddTodo(args) {
  const categories = await getCategories();

  // Categorie detecteren
  let categoryId = null;
  let categoryName = null;

  if (args.category) {
    const cat = categories.find(c => c.name.toLowerCase() === args.category.toLowerCase());
    if (cat) {
      categoryId = cat.id;
      categoryName = cat.name;
    }
  } else {
    const detected = detectCategory(args.title, categories);
    if (detected) {
      categoryId = detected.id;
      categoryName = detected.name;
    }
  }

  const todo = {
    title: args.title,
    categoryId,
    done: false,
    dueDate: args.due_date ? new Date(args.due_date) : null,
    timeEstimate: args.time_estimate || null,
    calendarEventId: null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  const docRef = await db.collection('todos').add(todo);

  return {
    status: 'aangemaakt',
    id: docRef.id,
    title: args.title,
    category: categoryName || 'Geen',
    dueDate: args.due_date || null,
    timeEstimate: args.time_estimate || null,
  };
}

async function handleCompleteTodo(args) {
  const docRef = db.collection('todos').doc(args.todo_id);
  const doc = await docRef.get();

  if (!doc.exists) {
    throw new Error(`Todo met ID "${args.todo_id}" niet gevonden`);
  }

  await docRef.update({
    done: true,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return {
    status: 'afgerond',
    id: args.todo_id,
    title: doc.data().title,
  };
}

async function handleReopenTodo(args) {
  const docRef = db.collection('todos').doc(args.todo_id);
  const doc = await docRef.get();

  if (!doc.exists) {
    throw new Error(`Todo met ID "${args.todo_id}" niet gevonden`);
  }

  await docRef.update({
    done: false,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return {
    status: 'heropend',
    id: args.todo_id,
    title: doc.data().title,
  };
}

async function handleUpdateTodo(args) {
  const docRef = db.collection('todos').doc(args.todo_id);
  const doc = await docRef.get();

  if (!doc.exists) {
    throw new Error(`Todo met ID "${args.todo_id}" niet gevonden`);
  }

  const updates = {
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  if (args.title) {
    updates.title = args.title;
  }

  if (args.category !== undefined) {
    const categories = await getCategories();
    const cat = categories.find(c => c.name.toLowerCase() === args.category.toLowerCase());
    updates.categoryId = cat ? cat.id : null;
  }

  if (args.due_date !== undefined) {
    updates.dueDate = args.due_date === 'none' ? null : new Date(args.due_date);
  }

  if (args.time_estimate !== undefined) {
    updates.timeEstimate = args.time_estimate === 0 ? null : args.time_estimate;
  }

  await docRef.update(updates);

  return {
    status: 'bijgewerkt',
    id: args.todo_id,
    wijzigingen: Object.keys(updates).filter(k => k !== 'updatedAt'),
  };
}

async function handleDeleteTodo(args) {
  const docRef = db.collection('todos').doc(args.todo_id);
  const doc = await docRef.get();

  if (!doc.exists) {
    throw new Error(`Todo met ID "${args.todo_id}" niet gevonden`);
  }

  const title = doc.data().title;
  await docRef.delete();

  return {
    status: 'verwijderd',
    id: args.todo_id,
    title,
  };
}

async function handleListCategories() {
  const categories = await getCategories();
  return {
    total: categories.length,
    categories: categories.map(cat => ({
      id: cat.id,
      name: cat.name,
      color: cat.color,
      keywords: cat.keywords || [],
    })),
  };
}

// ─── MCP Server ─────────────────────────────────────────────────

const server = new Server(
  { name: 'todo-server', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result;

    switch (name) {
      case 'list_todos':
        result = await handleListTodos(args || {});
        break;
      case 'add_todo':
        result = await handleAddTodo(args);
        break;
      case 'complete_todo':
        result = await handleCompleteTodo(args);
        break;
      case 'reopen_todo':
        result = await handleReopenTodo(args);
        break;
      case 'update_todo':
        result = await handleUpdateTodo(args);
        break;
      case 'delete_todo':
        result = await handleDeleteTodo(args);
        break;
      case 'list_categories':
        result = await handleListCategories();
        break;
      default:
        throw new Error(`Onbekende tool: ${name}`);
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Fout: ${error.message}` }],
      isError: true,
    };
  }
});

// Start
const transport = new StdioServerTransport();
await server.connect(transport);
console.error('Todo MCP server gestart');
