const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

const tableMap = {
  Patient: 'patients',
  Alert: 'alerts',
  VitalReading: 'vital_readings',
};

const parseSort = (sortBy) => {
  if (!sortBy) {
    return { column: 'created_at', ascending: false };
  }

  const ascending = !sortBy.startsWith('-');
  return {
    column: sortBy.replace(/^-/, ''),
    ascending,
  };
};

const getAuthToken = () => {
  if (typeof window === 'undefined') {
    return null;
  }

  return localStorage.getItem('supabase_access_token');
};

const requestSupabase = async ({ table, method = 'GET', query = {}, body, preferReturn = false }) => {
  const url = new URL(`${supabaseUrl}/rest/v1/${table}`);

  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, value);
    }
  });

  const token = getAuthToken();
  const headers = {
    apikey: supabaseAnonKey,
    Authorization: `Bearer ${token || supabaseAnonKey}`,
    'Content-Type': 'application/json',
  };

  if (preferReturn) {
    headers.Prefer = 'return=representation';
  }

  const response = await fetch(url.toString(), {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    let errorPayload;
    try {
      errorPayload = await response.json();
    } catch {
      errorPayload = null;
    }

    throw new Error(errorPayload?.message || `Supabase request failed (${response.status})`);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
};

const localEntityApi = {
  filter: async () => [],
  list: async () => [],
  get: async () => null,
  create: async (data) => ({ id: crypto.randomUUID(), ...data }),
  update: async (_, data) => data,
  delete: async () => ({}),
};

const createSupabaseEntityApi = (tableName) => ({
  list: async (sortBy = '-created_at', limitCount) => {
    const { column, ascending } = parseSort(sortBy);
    const result = await requestSupabase({
      table: tableName,
      query: {
        select: '*',
        order: `${column}.${ascending ? 'asc' : 'desc'}`,
        ...(limitCount ? { limit: String(limitCount) } : {}),
      },
    });

    return result ?? [];
  },

  filter: async (criteria = {}, sortBy = '-created_at', limitCount) => {
    const { column, ascending } = parseSort(sortBy);
    const filters = Object.fromEntries(
      Object.entries(criteria).map(([key, value]) => [key, `eq.${value}`]),
    );

    const result = await requestSupabase({
      table: tableName,
      query: {
        select: '*',
        order: `${column}.${ascending ? 'asc' : 'desc'}`,
        ...(limitCount ? { limit: String(limitCount) } : {}),
        ...filters,
      },
    });

    return result ?? [];
  },

  get: async (id) => {
    const result = await requestSupabase({
      table: tableName,
      query: {
        select: '*',
        id: `eq.${id}`,
        limit: '1',
      },
    });

    return result?.[0] ?? null;
  },

  create: async (payload) => {
    const result = await requestSupabase({
      table: tableName,
      method: 'POST',
      body: payload,
      preferReturn: true,
    });

    return result?.[0] ?? payload;
  },

  update: async (id, payload) => {
    const result = await requestSupabase({
      table: tableName,
      method: 'PATCH',
      query: { id: `eq.${id}` },
      body: payload,
      preferReturn: true,
    });

    return result?.[0] ?? { id, ...payload };
  },

  delete: async (id) => {
    await requestSupabase({
      table: tableName,
      method: 'DELETE',
      query: { id: `eq.${id}` },
    });

    return { id };
  },
});

const entities = new Proxy({}, {
  get: (_, entityName) => {
    if (!isSupabaseConfigured) {
      return localEntityApi;
    }

    const tableName = tableMap[entityName] ?? String(entityName).toLowerCase();
    return createSupabaseEntityApi(tableName);
  },
});

export const db = {
  isSupabaseConfigured,
  auth: {
    isAuthenticated: async () => Boolean(getAuthToken()),
    me: async () => {
      const token = getAuthToken();

      if (!isSupabaseConfigured || !token) {
        return null;
      }

      const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
        headers: {
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        return null;
      }

      return response.json();
    },
    logout: async () => {
      if (typeof window !== 'undefined') {
        localStorage.removeItem('supabase_access_token');
      }
    },
    redirectToLogin: (redirectTo = '/') => {
      window.location.href = `/login?redirect=${encodeURIComponent(redirectTo)}`;
    },
  },
  entities,
  integrations: {
    Core: {
      UploadFile: async () => ({ file_url: '' }),
    },
  },
};

export const base44 = db;
export default db;
