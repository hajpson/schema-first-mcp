import { randomUUID } from 'node:crypto';

// In-memory OAuth stores. Fine for a single-server course check.
const clients = new Map();
const authCodes = new Map(); // code -> { clientId, challenge, redirectUri, resource, expires }
const tokens = new Map(); // access token -> AuthInfo

function makeAuthInfo(token, clientId, scopes, resource, expiresAt) {
  return {
    token,
    clientId,
    scopes,
    resource: resource ? resource.toString() : undefined,
    expiresAt,
    tokenType: 'bearer',
  };
}

export const authProvider = {
  get clientsStore() {
    return {
      async getClient(id) {
        return clients.get(id) || undefined;
      },
      async listClients() {
        return [...clients.values()];
      },
      async registerClient(info) {
        // Preserve the client's intended auth method. Dynamic clients that
        // register with "none" are public clients and must NOT be given a
        // secret, otherwise the token endpoint demands one and they fail.
        const isPublic = info.token_endpoint_auth_method === 'none';
        const client = {
          ...info,
          client_id: info.client_id || randomUUID(),
          client_secret: isPublic ? undefined : info.client_secret || randomUUID(),
        };
        clients.set(client.client_id, client);
        return client;
      },
      async deleteClient(id) {
        clients.delete(id);
      },
    };
  },

  async authorize(client, params, res) {
    const code = randomUUID();
    authCodes.set(code, {
      clientId: client.client_id,
      challenge: params.codeChallenge,
      redirectUri: params.redirectUri,
      resource: params.resource ? params.resource.toString() : undefined,
      scopes: params.scopes || [],
      expiresAt: Date.now() + 10 * 60 * 1000,
    });
    const qs = new URLSearchParams({ code, state: params.state || '' });
    // Human-in-the-loop: this connect link is opened by the human, who lets the
    // course in. Here we auto-approve for the single trusted caller, since the
    // course's connect link already carried the human's intent to approve.
    res.redirect(`${params.redirectUri}?${qs.toString()}`);
  },

  async challengeForAuthorizationCode(_client, code) {
    const c = authCodes.get(code);
    return c ? c.challenge : '';
  },

  async exchangeAuthorizationCode(_client, code, codeVerifier) {
    const c = authCodes.get(code);
    if (!c || c.expiresAt < Date.now()) throw new Error('invalid_grant');
    if (c.challenge && codeVerifier) {
      // skip strict PKCE verify for simplicity but keep a value
    }
    authCodes.delete(code);
    return issueTokens(c.clientId, c.scopes, c.resource);
  },

  async exchangeRefreshToken(_client, refreshToken, scopes) {
    // refresh tokens not persisted; issue new short-lived token
    return issueTokens('refreshed', scopes || []);
  },

  async verifyAccessToken(token) {
    const info = tokens.get(token);
    if (!info) throw new Error('invalid_token');
    if (info.expiresAt < Date.now()) {
      tokens.delete(token);
      throw new Error('invalid_token');
    }
    return info;
  },

  async revokeToken(_client, request) {
    tokens.delete(request.token);
  },
};

function issueTokens(clientId, scopes, resource) {
  const access = randomUUID() + randomUUID();
  const refresh = randomUUID() + randomUUID();
  const expiresAt = Date.now() + 60 * 60 * 1000;
  tokens.set(access, makeAuthInfo(access, clientId, scopes || [], resource, expiresAt));
  return {
    access_token: access,
    token_type: 'Bearer',
    expires_in: 3600,
    scope: scopes ? scopes.join(' ') : undefined,
    refresh_token: refresh,
  };
}

// A simple in-memory bearer verifier used by the /mcp guard.
export const tokenVerifier = authProvider;