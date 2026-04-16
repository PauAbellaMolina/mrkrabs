const DEFAULT_BASE_URL = "https://api.cala.ai"

export const CALA_ENTITY_TYPES = [
  "Company",
  "Person",
  "Product",
  "Industry",
  "Law",
  "GPE",
  "CorporateEvent",
] as const

export type CalaRecord = Record<string, unknown>

export interface CalaClientConfig {
  apiKey?: string
  baseUrl?: string
  timeoutMs?: number
}

export interface CalaEntitySearchRequest {
  name: string
  entityTypes?: string[]
  limit?: number
}

export interface CalaEntitySearchHit {
  id: string
  name: string
  entityType?: string
  score?: number
  raw: CalaRecord
}

export interface CalaEntitySearchResponse {
  query: string
  entities: CalaEntitySearchHit[]
  raw: unknown
}

export interface CalaKnowledgeSearchEntity {
  id: string
  name: string
  entityType?: string
  mentions: string[]
  raw: CalaRecord
}

export interface CalaKnowledgeSearchResponse {
  input: string
  content?: string
  entities: CalaKnowledgeSearchEntity[]
  explainability: CalaRecord[]
  context: CalaRecord[]
  raw: unknown
}

export interface CalaEntityIntrospectionResponse {
  id: string
  entityType?: string
  properties?: CalaRecord
  relationships?: CalaRecord
  numericalObservations?: CalaRecord[]
  raw: unknown
}

export interface CalaRetrieveEntityRequest {
  fields?: string[]
  [key: string]: unknown
}

export interface CalaRetrievedEntity {
  id: string
  raw: CalaRecord
}

export interface CalaClientErrorContext {
  status: number
  code?: string
  requestUrl: string
  details?: unknown
}

const isStringRecord = (value: unknown): value is CalaRecord => {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

const readString = (value: unknown): string | undefined => {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

const readArray = (value: unknown): unknown[] => {
  return Array.isArray(value) ? value : []
}

export class CalaApiError extends Error {
  status: number
  code?: string
  requestUrl: string
  details?: unknown

  constructor(message: string, context: CalaClientErrorContext) {
    super(message)
    this.name = "CalaApiError"
    this.status = context.status
    this.code = context.code
    this.requestUrl = context.requestUrl
    this.details = context.details
  }
}

const normalizeSearchHits = (body: unknown): CalaRecord[] => {
  if (Array.isArray(body)) {
    return body.filter(isStringRecord)
  }

  if (!isStringRecord(body)) {
    return []
  }

  const candidates = [body.results, body.data, body.entities, body.items, body.response]
  for (const candidate of candidates) {
    const parsed = readArray(candidate).filter(isStringRecord)
    if (parsed.length > 0) {
      return parsed
    }
  }

  return []
}

const normalizeKnowledgeSearchEntities = (body: unknown): CalaRecord[] => {
  if (!isStringRecord(body)) {
    return []
  }

  return readArray(body.entities).filter(isStringRecord)
}

export class CalaClient {
  private readonly apiKey: string
  private readonly baseUrl: string
  private readonly timeoutMs: number

  constructor(config: CalaClientConfig = {}) {
    const apiKey = config.apiKey ?? process.env.CALA_API_KEY
    if (!apiKey) {
      throw new Error("CALA_API_KEY is required to use the Cala client")
    }

    const rawBaseUrl = config.baseUrl ?? process.env.CALA_API_BASE_URL ?? DEFAULT_BASE_URL
    this.baseUrl = rawBaseUrl.replace(/\/$/, "")
    this.apiKey = apiKey
    this.timeoutMs = config.timeoutMs ?? 15000
  }

  private async request<T>(method: "GET" | "POST", path: string, body?: CalaRecord): Promise<T> {
    const url = new URL(path, this.baseUrl).toString()
    const controller = new AbortController()
    const timeout =
      this.timeoutMs > 0
        ? setTimeout(() => controller.abort(), this.timeoutMs)
        : null

    try {
      const response = await fetch(url, {
        method,
        headers: {
          "X-API-KEY": this.apiKey,
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      })

      const text = await response.text()
      let details: unknown = null
      if (text) {
        try {
          details = JSON.parse(text)
        } catch {
          details = text
        }
      }

      if (!response.ok) {
        throw new CalaApiError(
          `Cala API request failed for ${path}: ${response.status} ${response.statusText}`,
          {
            status: response.status,
            requestUrl: url,
            details,
            code: isStringRecord(details) && typeof details.code === "string" ? details.code : undefined,
          },
        )
      }

      return details as T
    } catch (error) {
      if (error instanceof CalaApiError) {
        throw error
      }

      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`Cala API request timed out after ${this.timeoutMs}ms for ${path}`)
      }

      throw new Error(`Cala API request error for ${path}: ${error instanceof Error ? error.message : "Unknown error"}`)
    } finally {
      if (timeout) {
        clearTimeout(timeout)
      }
    }
  }

  async searchEntities(request: CalaEntitySearchRequest): Promise<CalaEntitySearchResponse> {
    const { name, limit, entityTypes } = request

    if (!name?.trim()) {
      throw new Error("searchEntities requires a non-empty name")
    }

    const searchParams = new URLSearchParams()
    searchParams.set("name", name)

    if (entityTypes?.length) {
      searchParams.set("entity_types", entityTypes.join(","))
    }

    if (limit) {
      searchParams.set("limit", String(limit))
    }

    const raw = await this.request<unknown>(
      "GET",
      `/v1/entities?${searchParams.toString()}`,
    )

    const rows = normalizeSearchHits(raw).map((row) => {
      const id =
        readString(row.id) ??
        readString(row.uuid) ??
        readString(row.entity_id) ??
        ""
      const entityName =
        readString(row.name) ??
        readString(row.entity_name) ??
        ""
      const entityType =
        readString(row.entity_type) ??
        readString(row.type) ??
        readString(row.entityType)
      const score =
        typeof row.score === "number"
          ? row.score
          : typeof row.relevance === "number"
            ? row.relevance
            : typeof row.similarity === "number"
              ? row.similarity
              : undefined

      return {
        id,
        name: entityName,
        entityType,
        score,
        raw: row,
      } satisfies CalaEntitySearchHit
    })

    return {
      query: name,
      entities: rows,
      raw,
    }
  }

  async knowledgeSearch(input: string): Promise<CalaKnowledgeSearchResponse> {
    if (!input?.trim()) {
      throw new Error("knowledgeSearch requires a non-empty input")
    }

    const raw = await this.request<unknown>("POST", "/v1/knowledge/search", {
      input,
    })

    const entityRows = normalizeKnowledgeSearchEntities(raw).map((row) => ({
      id:
        readString(row.id) ??
        readString(row.uuid) ??
        readString(row.entity_id) ??
        "",
      name:
        readString(row.name) ??
        readString(row.entity_name) ??
        "",
      entityType:
        readString(row.entity_type) ??
        readString(row.type) ??
        readString(row.entityType),
      mentions: readArray(row.mentions).filter((value): value is string => typeof value === "string"),
      raw: row,
    }))

    const parsed = isStringRecord(raw) ? raw : {}

    return {
      input,
      content: readString(parsed.content),
      entities: entityRows.filter(
        (entity) => entity.id.length > 0 && entity.name.length > 0,
      ),
      explainability: readArray(parsed.explainability).filter(isStringRecord),
      context: readArray(parsed.context).filter(isStringRecord),
      raw,
    }
  }

  async introspectEntity(entityId: string): Promise<CalaEntityIntrospectionResponse> {
    if (!entityId?.trim()) {
      throw new Error("introspectEntity requires a non-empty entityId")
    }

    const raw = await this.request<CalaRecord>("GET", `/v1/entities/${encodeURIComponent(entityId)}/introspection`)

    if (!isStringRecord(raw)) {
      return {
        id: entityId,
        raw,
      }
    }

    const properties = isStringRecord(raw.properties)
      ? raw.properties
      : undefined
    const relationships = isStringRecord(raw.relationships)
      ? raw.relationships
      : isStringRecord(raw.relationship_data)
        ? raw.relationship_data
        : undefined

    const rawNumericalObservations = readArray(raw.numerical_observations ?? raw.numericalObservations)
    const numericalObservations = rawNumericalObservations.filter(isStringRecord)

    return {
      id: readString(raw.id) ?? entityId,
      entityType: readString(raw.entity_type) ?? readString(raw.entityType),
      properties,
      relationships,
      numericalObservations,
      raw,
    }
  }

  async retrieveEntity(entityId: string, request: CalaRetrieveEntityRequest = {}): Promise<CalaRetrievedEntity> {
    if (!entityId?.trim()) {
      throw new Error("retrieveEntity requires a non-empty entityId")
    }

    const payload = Object.keys(request).length > 0 ? request : undefined

    const raw = await this.request<CalaRecord>("POST", `/v1/entities/${encodeURIComponent(entityId)}`, payload)

    if (!isStringRecord(raw)) {
      return {
        id: entityId,
        raw: {
          id: entityId,
          payload,
        },
      }
    }

    const id = readString(raw.id) ?? entityId

    return {
      id,
      raw,
    }
  }
}

export const createCalaClient = (config: CalaClientConfig = {}): CalaClient => {
  return new CalaClient(config)
}
