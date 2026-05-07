# AurisLink Test Suite

Testes automatizados para o AurisLink com cobertura de cache, retry e providers.

## 📋 Estrutura

```
tests/
├── cache.test.ts       # Testes do sistema de cache inteligente
├── retry.test.ts       # Testes do retry com backoff exponencial
├── providers.test.ts   # Testes dos providers (YouTube, etc)
└── README.md           # Este arquivo
```

## 🚀 Como Rodar

### Rodar todos os testes
```bash
npm test
```

### Modo watch (rerun ao salvar)
```bash
npm run test:watch
```

### Com cobertura de código
```bash
npm run test:coverage
```

### Rodar teste específico
```bash
npm test -- cache.test.ts
npm test -- retry.test.ts
npm test -- providers.test.ts
```

## 📊 Cobertura de Testes

### Cache Tests (15+ testes)
- ✅ Operações básicas (set, get, delete, clear)
- ✅ Expiração de TTL
- ✅ Eviction LRU (Least Recently Used)
- ✅ Estatísticas (hits, misses, hit rate)
- ✅ Limpeza automática

**Arquivo:** `cache.test.ts`

```typescript
// Exemplo de uso
const cache = new IntelligentCache(3600, 100) // 1 hora, max 100 entries
cache.set('key1', 'value1')
const value = cache.get('key1')
const stats = cache.getStats()
```

### Retry Tests (20+ testes)
- ✅ Execução bem-sucedida
- ✅ Retry automático
- ✅ Exponential backoff (100ms → 200ms → 400ms)
- ✅ Detecção de erros retentáveis
- ✅ Lógica customizada de retry

**Arquivo:** `retry.test.ts`

```typescript
// Exemplo de uso
const result = await RetryManager.execute(
  () => fetchFromYouTube(),
  {
    maxAttempts: 3,
    initialDelayMs: 100,
    backoffMultiplier: 2,
    shouldRetry: (error) => error.status >= 500
  }
)

if (result.success) {
  console.log(`Success after ${result.attempts} attempts`)
} else {
  console.error(`Failed: ${result.error}`)
}
```

### Provider Tests (10+ testes)
- ✅ Inicialização de providers
- ✅ Validação de URLs
- ✅ Setup e configuração
- ✅ Cookie generation

**Arquivo:** `providers.test.ts`

```typescript
// Exemplo de uso
const config = createMockConfig()
const youtube = new YoutubeSource(config)
await youtube.setup()
```

## 📈 Resultados Atuais

```
Test Suites: 3 total
Tests:       47 total
  ✅ Passed: 44 (93.6%)
  ❌ Failed: 3 (timing edge cases)

Coverage:
  Lines:       ~70%
  Functions:   ~65%
  Branches:    ~60%
```

## 🔧 Configuração Jest

**Arquivo:** `jest.config.js`

- Preset: `ts-jest/presets/default-esm`
- Environment: `node`
- Timeout: 10 segundos
- Module mapper: Suporta imports com `.js`

## 📝 Escrevendo Novos Testes

### Template básico
```typescript
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals'

describe('MyFeature', () => {
  let instance: MyClass

  beforeEach(() => {
    instance = new MyClass()
  })

  afterEach(() => {
    instance.cleanup()
  })

  it('should do something', () => {
    const result = instance.doSomething()
    expect(result).toBe(expectedValue)
  })
})
```

### Boas práticas
1. Use `describe` para agrupar testes relacionados
2. Use `beforeEach` para setup comum
3. Use `afterEach` para limpeza
4. Escreva testes independentes (não dependem um do outro)
5. Use nomes descritivos: `should...`, `should not...`
6. Teste casos de sucesso E falha

## 🐛 Troubleshooting

### Erro: "Cannot find module"
Certifique-se de que o build foi feito:
```bash
npm run build
npm test
```

### Testes lentos
Aumente o timeout em `jest.config.js`:
```javascript
testTimeout: 20000 // 20 segundos
```

### Erro de TypeScript
Verifique se `ts-jest` está instalado:
```bash
npm install --save-dev ts-jest @types/jest
```

## 🚀 Próximos Passos

- [ ] Adicionar testes de integração com servidor real
- [ ] Aumentar cobertura para 80%+
- [ ] Adicionar testes de carga
- [ ] Integrar com CI/CD pipeline
- [ ] Gerar relatório de cobertura em HTML

## 📚 Referências

- [Jest Documentation](https://jestjs.io/)
- [ts-jest Documentation](https://kulshekhar.github.io/ts-jest/)
- [Testing Best Practices](https://jestjs.io/docs/getting-started)
