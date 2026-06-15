# Sample

```mermaid
flowchart TD
  A["Agent DO<br/>(evicted, then restarts)"] -->|proxy| B["Inference Buffer<br/>(separate DO)<br/>keeps reading - stores chunks"]
  B -->|fetch| P["Provider<br/>(OpenAI, Anthropic, Workers AI)"]
  B -->|stream| A
