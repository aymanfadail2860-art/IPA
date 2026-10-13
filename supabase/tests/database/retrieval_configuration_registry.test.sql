-- pgTAP: 8B-I6 — register over retrieval-konfigurationer, evaluation_publisher, godkendelse,
-- aktivering, suspendering og retrieval-konteksten (docs/08b §4.5, §9, §10, §21.9).
-- Alt rulles tilbage.
--
-- Rapporten nedenfor er GENERERET af den rigtige evalueringsmotor (src/tests/fixtures/
-- evaluation-report.ts, buildReport()) — den samme, som TypeScript-testene bruger. En Vitest-test
-- (evaluation-publisher.test.ts) kontrollerer, at literalen her er identisk med den genererede.
-- Testen kører som postgres; "set local role evaluation_publisher_login" kræver, at postgres
-- midlertidigt får SET på login-rollen (kun i transaktionen).
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(355);

-- ----------------------------------------------------------------------------
-- Hjælpere (kun i testens transaktion)
-- ----------------------------------------------------------------------------

-- Den genererede rapport og gate-sættet, præcis som TypeScript skrev dem.
create function pg_temp.ts_report() returns jsonb language sql immutable as $f$ select $report${"reportSchema":6,"kind":"retrieval-evaluation","engine":"beta-L1.1/6","runId":"f6000000-0000-4000-8000-0000000000aa","startedAt":"2026-10-05T08:00:00.000Z","finishedAt":"2026-10-05T08:05:00.000Z","evalSet":{"setId":"fixture-pilot","version":1,"caseSchema":1,"checksum":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","activeCases":99,"retiredCases":0,"byType":{"direct":75,"multi_chunk":0,"historical":3,"conflict":2,"unanswerable":6,"distractor":3,"permission":10,"filter":0},"bySplit":{"dev":99,"holdout":0}},"gateSet":{"id":"gates","version":1,"decision":"B-020","method":"hybrid","k":8,"checksum":"b573b331ee808054289f7bb44ae5ffe0471a1be68fd266cdc45a3b5d19349149"},"configuration":{"label":"fixture-bedrock","adapter":"fixture-evaluation","environment":"evaluation","declared":{"embedding":{"provider":"aws-bedrock","model":"cohere.embed-v4:0","modelVersion":"eu-1024-v1","dimensions":1024,"processing":{"kind":"geographic","geography":"EU","sourceRegion":"eu-central-1","inferenceProfile":"eu.cohere.embed-v4:0"},"settings":{"embeddingType":"float","outputDimension":1024,"truncate":"NONE","inputTypeDocument":"search_document","inputTypeQuery":"search_query"}},"reranker":{"provider":"aws-bedrock","model":"cohere.rerank-v3-5:0","modelVersion":"euc1-v1","id":"aws-bedrock:cohere.rerank-v3-5:0","version":"euc1-v1","processing":{"kind":"in_region","region":"eu-central-1"},"settings":{"apiVersion":2,"topN":"all","document":"heading-path+text","ties":"candidate-order"}},"algorithmVersion":"hybrid-rrf-1","params":{"candidateK":50,"rerankN":30,"topK":8,"maxPerVersion":3,"minScore":0.1,"rrfK":60},"chunkerVersions":["structure/1"]},"declaredFingerprint":"b8387050bf3167c008dd86cfaf5a6c4cad72e919519dc21a18efe99c149e7efc","runtime":{"embedding":{"provider":"aws-bedrock","model":"cohere.embed-v4:0","modelVersion":"eu-1024-v1","dimensions":1024,"processing":{"kind":"geographic","geography":"EU","sourceRegion":"eu-central-1","inferenceProfile":"eu.cohere.embed-v4:0"},"settings":{"embeddingType":"float","outputDimension":1024,"truncate":"NONE","inputTypeDocument":"search_document","inputTypeQuery":"search_query"}},"reranker":{"provider":"aws-bedrock","model":"cohere.rerank-v3-5:0","modelVersion":"euc1-v1","id":"aws-bedrock:cohere.rerank-v3-5:0","version":"euc1-v1","processing":{"kind":"in_region","region":"eu-central-1"},"settings":{"apiVersion":2,"topN":"all","document":"heading-path+text","ties":"candidate-order"}},"algorithmVersion":"hybrid-rrf-1","params":{"candidateK":50,"rerankN":30,"topK":8,"maxPerVersion":3,"minScore":0.1,"rrfK":60},"chunkerVersions":["structure/1"]},"runtimeFingerprint":"b8387050bf3167c008dd86cfaf5a6c4cad72e919519dc21a18efe99c149e7efc","matches":true},"corpus":{"checksumBefore":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","checksumAfter":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","documentTypes":["terms"],"scope":[{"documentType":"terms","productId":"fa000000-0000-4000-8000-000000000001","productName":"Fiktivt erhvervsansvar"},{"documentType":"terms","productId":"fa000000-0000-4000-8000-000000000002","productName":"Testprodukt (fiktiv)"}]},"metrics":{"source_recall_at_k":{"value":1,"numerator":83,"denominator":83,"interval":{"lower":0.9557646903580262,"upper":1}},"passage_recall_at_k":{"value":1,"numerator":83,"denominator":83,"interval":{"lower":0.9557646903580262,"upper":1}},"mrr_at_k":{"value":1,"numerator":null,"denominator":83,"interval":null},"correct_abstention":{"value":1,"numerator":16,"denominator":16,"interval":{"lower":0.8063923194655637,"upper":1}},"false_abstention":{"value":0,"numerator":0,"denominator":83,"interval":{"lower":0,"upper":0.04423530964197385}},"distractor_intrusion":{"value":0,"numerator":0,"denominator":36,"interval":{"lower":0,"upper":0.09641862859446367}},"informational":{"source_recall_at_1":{"value":1,"numerator":83,"denominator":83,"interval":{"lower":0.9557646903580262,"upper":1}},"source_recall_at_3":{"value":1,"numerator":83,"denominator":83,"interval":{"lower":0.9557646903580262,"upper":1}},"full_coverage_at_k":{"value":1,"numerator":null,"denominator":83,"interval":null},"ndcg_at_k":{"value":1,"numerator":null,"denominator":83,"interval":null}}},"rerankerComparison":{"available":true,"withReranker":{"passage_recall_at_k":1,"mrr_at_k":1},"withoutReranker":{"passage_recall_at_k":1,"mrr_at_k":1}},"hardGates":[{"id":"H1","status":"pass","violations":0},{"id":"H2","status":"pass","violations":0},{"id":"H3","status":"pass","violations":0},{"id":"H4","status":"pass","violations":0},{"id":"H5","status":"pass","violations":0},{"id":"H6","status":"pass","violations":0},{"id":"H7","status":"pass","violations":0}],"qualityGates":[{"id":"Q1","metric":"source_recall_at_k","comparator":">=","threshold":0.95,"value":1,"status":"pass","uncertain":false,"explanation":"1.000 ≥ 0.950 (83/83), 95 %-interval [0.956; 1.000]."},{"id":"Q2","metric":"passage_recall_at_k","comparator":">=","threshold":0.85,"value":1,"status":"pass","uncertain":false,"explanation":"1.000 ≥ 0.850 (83/83), 95 %-interval [0.956; 1.000]."},{"id":"Q3","metric":"mrr_at_k","comparator":">=","threshold":0.7,"value":1,"status":"pass","uncertain":false,"explanation":"1.000 ≥ 0.700 (n = 83)."},{"id":"Q4","metric":"correct_abstention","comparator":">=","threshold":0.8,"value":1,"status":"pass","uncertain":false,"explanation":"1.000 ≥ 0.800 (16/16), 95 %-interval [0.806; 1.000]."},{"id":"Q5","metric":"false_abstention","comparator":"<=","threshold":0.1,"value":0,"status":"pass","uncertain":false,"explanation":"0.000 ≤ 0.100 (0/83), 95 %-interval [0.000; 0.044]."},{"id":"Q6","metric":"distractor_intrusion","comparator":"<=","threshold":0.1,"value":0,"status":"pass","uncertain":false,"explanation":"0.000 ≤ 0.100 (0/36), 95 %-interval [0.000; 0.096]."},{"id":"Q7","metric":"reranker_uplift","comparator":"not_lower","threshold":null,"value":0,"status":"pass","uncertain":false,"explanation":"Med reranker: Passage Recall 1.000, MRR 1.000. Uden: 1.000, 1.000."}],"minimums":[{"label":"besvarbare (direct og multi_chunk)","minimum":20,"actual":75,"met":true},{"label":"ubesvarbare","minimum":5,"actual":6,"met":true},{"label":"historiske","minimum":3,"actual":3,"met":true},{"label":"konflikt","minimum":2,"actual":2,"met":true},{"label":"distraktor","minimum":3,"actual":3,"met":true},{"label":"adgang eller filter","minimum":3,"actual":10,"met":true}],"tier":"pilot","verdict":"pass","valid":true,"invalidReasons":[],"failures":[],"cases":[{"caseId":"direct-001","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-002","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-003","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-004","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-005","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-006","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-007","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-008","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-009","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-010","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-011","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-012","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-013","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-014","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-015","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-016","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-017","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-018","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-019","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-020","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-021","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-022","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-023","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-024","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-025","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-026","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-027","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-028","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-029","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-030","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-031","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-032","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-033","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-034","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-035","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-036","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-037","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-038","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-039","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-040","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-041","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-042","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-043","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-044","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-045","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-046","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-047","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-048","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-049","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-050","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-051","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-052","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-053","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-054","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-055","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-056","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-057","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-058","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-059","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-060","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-061","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-062","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-063","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-064","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-065","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-066","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-067","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-068","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-069","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-070","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-071","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-072","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-073","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-074","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-075","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"historical-001","type":"historical","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"historical-002","type":"historical","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"historical-003","type":"historical","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"conflict-001","type":"conflict","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"conflict-002","type":"conflict","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"unanswerable-001","type":"unanswerable","split":"dev","outcome":"insufficient","itemCount":0,"empty":true,"sourceRank":null,"firstGrade3Rank":null,"requiredCovered":0,"requiredTotal":0,"gainsByRank":[],"idealGains":[],"itemsWithinK":0,"distractorItems":0,"violations":[],"error":null},{"caseId":"unanswerable-002","type":"unanswerable","split":"dev","outcome":"insufficient","itemCount":0,"empty":true,"sourceRank":null,"firstGrade3Rank":null,"requiredCovered":0,"requiredTotal":0,"gainsByRank":[],"idealGains":[],"itemsWithinK":0,"distractorItems":0,"violations":[],"error":null},{"caseId":"unanswerable-003","type":"unanswerable","split":"dev","outcome":"insufficient","itemCount":0,"empty":true,"sourceRank":null,"firstGrade3Rank":null,"requiredCovered":0,"requiredTotal":0,"gainsByRank":[],"idealGains":[],"itemsWithinK":0,"distractorItems":0,"violations":[],"error":null},{"caseId":"unanswerable-004","type":"unanswerable","split":"dev","outcome":"insufficient","itemCount":0,"empty":true,"sourceRank":null,"firstGrade3Rank":null,"requiredCovered":0,"requiredTotal":0,"gainsByRank":[],"idealGains":[],"itemsWithinK":0,"distractorItems":0,"violations":[],"error":null},{"caseId":"unanswerable-005","type":"unanswerable","split":"dev","outcome":"insufficient","itemCount":0,"empty":true,"sourceRank":null,"firstGrade3Rank":null,"requiredCovered":0,"requiredTotal":0,"gainsByRank":[],"idealGains":[],"itemsWithinK":0,"distractorItems":0,"violations":[],"error":null},{"caseId":"unanswerable-006","type":"unanswerable","split":"dev","outcome":"insufficient","itemCount":0,"empty":true,"sourceRank":null,"firstGrade3Rank":null,"requiredCovered":0,"requiredTotal":0,"gainsByRank":[],"idealGains":[],"itemsWithinK":0,"distractorItems":0,"violations":[],"error":null},{"caseId":"distractor-001","type":"distractor","split":"dev","outcome":"evidence","itemCount":12,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":12,"distractorItems":0,"violations":[],"error":null},{"caseId":"distractor-002","type":"distractor","split":"dev","outcome":"evidence","itemCount":12,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":12,"distractorItems":0,"violations":[],"error":null},{"caseId":"distractor-003","type":"distractor","split":"dev","outcome":"evidence","itemCount":12,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":12,"distractorItems":0,"violations":[],"error":null},{"caseId":"permission-001","type":"permission","split":"dev","outcome":"insufficient","itemCount":0,"empty":true,"sourceRank":null,"firstGrade3Rank":null,"requiredCovered":0,"requiredTotal":0,"gainsByRank":[],"idealGains":[],"itemsWithinK":0,"distractorItems":0,"violations":[],"error":null},{"caseId":"permission-002","type":"permission","split":"dev","outcome":"insufficient","itemCount":0,"empty":true,"sourceRank":null,"firstGrade3Rank":null,"requiredCovered":0,"requiredTotal":0,"gainsByRank":[],"idealGains":[],"itemsWithinK":0,"distractorItems":0,"violations":[],"error":null},{"caseId":"permission-003","type":"permission","split":"dev","outcome":"insufficient","itemCount":0,"empty":true,"sourceRank":null,"firstGrade3Rank":null,"requiredCovered":0,"requiredTotal":0,"gainsByRank":[],"idealGains":[],"itemsWithinK":0,"distractorItems":0,"violations":[],"error":null},{"caseId":"permission-004","type":"permission","split":"dev","outcome":"insufficient","itemCount":0,"empty":true,"sourceRank":null,"firstGrade3Rank":null,"requiredCovered":0,"requiredTotal":0,"gainsByRank":[],"idealGains":[],"itemsWithinK":0,"distractorItems":0,"violations":[],"error":null},{"caseId":"permission-005","type":"permission","split":"dev","outcome":"insufficient","itemCount":0,"empty":true,"sourceRank":null,"firstGrade3Rank":null,"requiredCovered":0,"requiredTotal":0,"gainsByRank":[],"idealGains":[],"itemsWithinK":0,"distractorItems":0,"violations":[],"error":null},{"caseId":"permission-006","type":"permission","split":"dev","outcome":"insufficient","itemCount":0,"empty":true,"sourceRank":null,"firstGrade3Rank":null,"requiredCovered":0,"requiredTotal":0,"gainsByRank":[],"idealGains":[],"itemsWithinK":0,"distractorItems":0,"violations":[],"error":null},{"caseId":"permission-007","type":"permission","split":"dev","outcome":"insufficient","itemCount":0,"empty":true,"sourceRank":null,"firstGrade3Rank":null,"requiredCovered":0,"requiredTotal":0,"gainsByRank":[],"idealGains":[],"itemsWithinK":0,"distractorItems":0,"violations":[],"error":null},{"caseId":"permission-008","type":"permission","split":"dev","outcome":"insufficient","itemCount":0,"empty":true,"sourceRank":null,"firstGrade3Rank":null,"requiredCovered":0,"requiredTotal":0,"gainsByRank":[],"idealGains":[],"itemsWithinK":0,"distractorItems":0,"violations":[],"error":null},{"caseId":"permission-009","type":"permission","split":"dev","outcome":"insufficient","itemCount":0,"empty":true,"sourceRank":null,"firstGrade3Rank":null,"requiredCovered":0,"requiredTotal":0,"gainsByRank":[],"idealGains":[],"itemsWithinK":0,"distractorItems":0,"violations":[],"error":null},{"caseId":"permission-010","type":"permission","split":"dev","outcome":"insufficient","itemCount":0,"empty":true,"sourceRank":null,"firstGrade3Rank":null,"requiredCovered":0,"requiredTotal":0,"gainsByRank":[],"idealGains":[],"itemsWithinK":0,"distractorItems":0,"violations":[],"error":null}],"production":{"eligible":false,"reason":"En rapport er data og erklærer aldrig sig selv production-egnet. Kun evaluation_publisher kan registrere den (knowledge.record_evaluation_run), og kun et menneske med system.settings.manage kan derefter godkende og aktivere konfigurationen. Evidensens grad afgøres af P1–P9 ved hvert retrieval (docs/08b §9–§10)."},"checksums":{"results":"7bdc99f5668922755360d873e4f73d015e31563d7849eb1fd2fefa352c1bbbec","report":"636b9f4eb46193ad4b0242b5e2279e26a7d4e06d587988aa8be1f3dcf0b4fe36"}}$report$::jsonb $f$;
create function pg_temp.ts_uncertain_pilot() returns jsonb language sql immutable as $f$ select $uncertainpilot${"reportSchema":6,"kind":"retrieval-evaluation","engine":"beta-L1.1/6","runId":"f6000000-0000-4000-8000-0000000000ab","startedAt":"2026-10-05T08:00:00.000Z","finishedAt":"2026-10-05T08:05:00.000Z","evalSet":{"setId":"fixture-pilot","version":1,"caseSchema":1,"checksum":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","activeCases":36,"retiredCases":0,"byType":{"direct":20,"multi_chunk":0,"historical":3,"conflict":2,"unanswerable":5,"distractor":3,"permission":3,"filter":0},"bySplit":{"dev":36,"holdout":0}},"gateSet":{"id":"gates","version":1,"decision":"B-020","method":"hybrid","k":8,"checksum":"b573b331ee808054289f7bb44ae5ffe0471a1be68fd266cdc45a3b5d19349149"},"configuration":{"label":"fixture-bedrock","adapter":"fixture-evaluation","environment":"evaluation","declared":{"embedding":{"provider":"aws-bedrock","model":"cohere.embed-v4:0","modelVersion":"eu-1024-v1","dimensions":1024,"processing":{"kind":"geographic","geography":"EU","sourceRegion":"eu-central-1","inferenceProfile":"eu.cohere.embed-v4:0"},"settings":{"embeddingType":"float","outputDimension":1024,"truncate":"NONE","inputTypeDocument":"search_document","inputTypeQuery":"search_query"}},"reranker":{"provider":"aws-bedrock","model":"cohere.rerank-v3-5:0","modelVersion":"euc1-v1","id":"aws-bedrock:cohere.rerank-v3-5:0","version":"euc1-v1","processing":{"kind":"in_region","region":"eu-central-1"},"settings":{"apiVersion":2,"topN":"all","document":"heading-path+text","ties":"candidate-order"}},"algorithmVersion":"hybrid-rrf-1","params":{"candidateK":50,"rerankN":30,"topK":8,"maxPerVersion":3,"minScore":0.1,"rrfK":60},"chunkerVersions":["structure/1"]},"declaredFingerprint":"b8387050bf3167c008dd86cfaf5a6c4cad72e919519dc21a18efe99c149e7efc","runtime":{"embedding":{"provider":"aws-bedrock","model":"cohere.embed-v4:0","modelVersion":"eu-1024-v1","dimensions":1024,"processing":{"kind":"geographic","geography":"EU","sourceRegion":"eu-central-1","inferenceProfile":"eu.cohere.embed-v4:0"},"settings":{"embeddingType":"float","outputDimension":1024,"truncate":"NONE","inputTypeDocument":"search_document","inputTypeQuery":"search_query"}},"reranker":{"provider":"aws-bedrock","model":"cohere.rerank-v3-5:0","modelVersion":"euc1-v1","id":"aws-bedrock:cohere.rerank-v3-5:0","version":"euc1-v1","processing":{"kind":"in_region","region":"eu-central-1"},"settings":{"apiVersion":2,"topN":"all","document":"heading-path+text","ties":"candidate-order"}},"algorithmVersion":"hybrid-rrf-1","params":{"candidateK":50,"rerankN":30,"topK":8,"maxPerVersion":3,"minScore":0.1,"rrfK":60},"chunkerVersions":["structure/1"]},"runtimeFingerprint":"b8387050bf3167c008dd86cfaf5a6c4cad72e919519dc21a18efe99c149e7efc","matches":true},"corpus":{"checksumBefore":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","checksumAfter":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","documentTypes":["terms"],"scope":[{"documentType":"terms","productId":"fa000000-0000-4000-8000-000000000001","productName":"Fiktivt erhvervsansvar"},{"documentType":"terms","productId":"fa000000-0000-4000-8000-000000000002","productName":"Testprodukt (fiktiv)"}]},"metrics":{"source_recall_at_k":{"value":1,"numerator":28,"denominator":28,"interval":{"lower":0.8793566952341543,"upper":1}},"passage_recall_at_k":{"value":1,"numerator":28,"denominator":28,"interval":{"lower":0.8793566952341543,"upper":1}},"mrr_at_k":{"value":1,"numerator":null,"denominator":28,"interval":null},"correct_abstention":{"value":1,"numerator":8,"denominator":8,"interval":{"lower":0.6755924351161198,"upper":1}},"false_abstention":{"value":0,"numerator":0,"denominator":28,"interval":{"lower":0,"upper":0.12064330476584563}},"distractor_intrusion":{"value":0,"numerator":0,"denominator":36,"interval":{"lower":0,"upper":0.09641862859446367}},"informational":{"source_recall_at_1":{"value":1,"numerator":28,"denominator":28,"interval":{"lower":0.8793566952341543,"upper":1}},"source_recall_at_3":{"value":1,"numerator":28,"denominator":28,"interval":{"lower":0.8793566952341543,"upper":1}},"full_coverage_at_k":{"value":1,"numerator":null,"denominator":28,"interval":null},"ndcg_at_k":{"value":1,"numerator":null,"denominator":28,"interval":null}}},"rerankerComparison":{"available":true,"withReranker":{"passage_recall_at_k":1,"mrr_at_k":1},"withoutReranker":{"passage_recall_at_k":1,"mrr_at_k":1}},"hardGates":[{"id":"H1","status":"pass","violations":0},{"id":"H2","status":"pass","violations":0},{"id":"H3","status":"pass","violations":0},{"id":"H4","status":"pass","violations":0},{"id":"H5","status":"pass","violations":0},{"id":"H6","status":"pass","violations":0},{"id":"H7","status":"pass","violations":0}],"qualityGates":[{"id":"Q1","metric":"source_recall_at_k","comparator":">=","threshold":0.95,"value":1,"status":"pass","uncertain":true,"explanation":"1.000 ≥ 0.950 (28/28), 95 %-interval [0.879; 1.000]."},{"id":"Q2","metric":"passage_recall_at_k","comparator":">=","threshold":0.85,"value":1,"status":"pass","uncertain":false,"explanation":"1.000 ≥ 0.850 (28/28), 95 %-interval [0.879; 1.000]."},{"id":"Q3","metric":"mrr_at_k","comparator":">=","threshold":0.7,"value":1,"status":"pass","uncertain":false,"explanation":"1.000 ≥ 0.700 (n = 28)."},{"id":"Q4","metric":"correct_abstention","comparator":">=","threshold":0.8,"value":1,"status":"pass","uncertain":true,"explanation":"1.000 ≥ 0.800 (8/8), 95 %-interval [0.676; 1.000]."},{"id":"Q5","metric":"false_abstention","comparator":"<=","threshold":0.1,"value":0,"status":"pass","uncertain":true,"explanation":"0.000 ≤ 0.100 (0/28), 95 %-interval [0.000; 0.121]."},{"id":"Q6","metric":"distractor_intrusion","comparator":"<=","threshold":0.1,"value":0,"status":"pass","uncertain":false,"explanation":"0.000 ≤ 0.100 (0/36), 95 %-interval [0.000; 0.096]."},{"id":"Q7","metric":"reranker_uplift","comparator":"not_lower","threshold":null,"value":0,"status":"pass","uncertain":false,"explanation":"Med reranker: Passage Recall 1.000, MRR 1.000. Uden: 1.000, 1.000."}],"minimums":[{"label":"besvarbare (direct og multi_chunk)","minimum":20,"actual":20,"met":true},{"label":"ubesvarbare","minimum":5,"actual":5,"met":true},{"label":"historiske","minimum":3,"actual":3,"met":true},{"label":"konflikt","minimum":2,"actual":2,"met":true},{"label":"distraktor","minimum":3,"actual":3,"met":true},{"label":"adgang eller filter","minimum":3,"actual":3,"met":true}],"tier":"pilot","verdict":"uncertain","valid":true,"invalidReasons":[],"failures":[],"cases":[{"caseId":"direct-001","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-002","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-003","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-004","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-005","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-006","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-007","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-008","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-009","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-010","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-011","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-012","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-013","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-014","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-015","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-016","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-017","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-018","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-019","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-020","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"historical-001","type":"historical","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"historical-002","type":"historical","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"historical-003","type":"historical","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"conflict-001","type":"conflict","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"conflict-002","type":"conflict","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"unanswerable-001","type":"unanswerable","split":"dev","outcome":"insufficient","itemCount":0,"empty":true,"sourceRank":null,"firstGrade3Rank":null,"requiredCovered":0,"requiredTotal":0,"gainsByRank":[],"idealGains":[],"itemsWithinK":0,"distractorItems":0,"violations":[],"error":null},{"caseId":"unanswerable-002","type":"unanswerable","split":"dev","outcome":"insufficient","itemCount":0,"empty":true,"sourceRank":null,"firstGrade3Rank":null,"requiredCovered":0,"requiredTotal":0,"gainsByRank":[],"idealGains":[],"itemsWithinK":0,"distractorItems":0,"violations":[],"error":null},{"caseId":"unanswerable-003","type":"unanswerable","split":"dev","outcome":"insufficient","itemCount":0,"empty":true,"sourceRank":null,"firstGrade3Rank":null,"requiredCovered":0,"requiredTotal":0,"gainsByRank":[],"idealGains":[],"itemsWithinK":0,"distractorItems":0,"violations":[],"error":null},{"caseId":"unanswerable-004","type":"unanswerable","split":"dev","outcome":"insufficient","itemCount":0,"empty":true,"sourceRank":null,"firstGrade3Rank":null,"requiredCovered":0,"requiredTotal":0,"gainsByRank":[],"idealGains":[],"itemsWithinK":0,"distractorItems":0,"violations":[],"error":null},{"caseId":"unanswerable-005","type":"unanswerable","split":"dev","outcome":"insufficient","itemCount":0,"empty":true,"sourceRank":null,"firstGrade3Rank":null,"requiredCovered":0,"requiredTotal":0,"gainsByRank":[],"idealGains":[],"itemsWithinK":0,"distractorItems":0,"violations":[],"error":null},{"caseId":"distractor-001","type":"distractor","split":"dev","outcome":"evidence","itemCount":12,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":12,"distractorItems":0,"violations":[],"error":null},{"caseId":"distractor-002","type":"distractor","split":"dev","outcome":"evidence","itemCount":12,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":12,"distractorItems":0,"violations":[],"error":null},{"caseId":"distractor-003","type":"distractor","split":"dev","outcome":"evidence","itemCount":12,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":12,"distractorItems":0,"violations":[],"error":null},{"caseId":"permission-001","type":"permission","split":"dev","outcome":"insufficient","itemCount":0,"empty":true,"sourceRank":null,"firstGrade3Rank":null,"requiredCovered":0,"requiredTotal":0,"gainsByRank":[],"idealGains":[],"itemsWithinK":0,"distractorItems":0,"violations":[],"error":null},{"caseId":"permission-002","type":"permission","split":"dev","outcome":"insufficient","itemCount":0,"empty":true,"sourceRank":null,"firstGrade3Rank":null,"requiredCovered":0,"requiredTotal":0,"gainsByRank":[],"idealGains":[],"itemsWithinK":0,"distractorItems":0,"violations":[],"error":null},{"caseId":"permission-003","type":"permission","split":"dev","outcome":"insufficient","itemCount":0,"empty":true,"sourceRank":null,"firstGrade3Rank":null,"requiredCovered":0,"requiredTotal":0,"gainsByRank":[],"idealGains":[],"itemsWithinK":0,"distractorItems":0,"violations":[],"error":null}],"production":{"eligible":false,"reason":"En rapport er data og erklærer aldrig sig selv production-egnet. Kun evaluation_publisher kan registrere den (knowledge.record_evaluation_run), og kun et menneske med system.settings.manage kan derefter godkende og aktivere konfigurationen. Evidensens grad afgøres af P1–P9 ved hvert retrieval (docs/08b §9–§10)."},"checksums":{"results":"a5a9bf65b2765863c7b98384b29203e2d0faa3d9b0802800a21cfe2f83a254fd","report":"b8f4fff1c58ff02230e6bf0112805ea98a936ba61a9ce10b226a048b80481316"}}$uncertainpilot$::jsonb $f$;
create function pg_temp.ts_uncertain_standard() returns jsonb language sql immutable as $f$ select $uncertainstandard${"reportSchema":6,"kind":"retrieval-evaluation","engine":"beta-L1.1/6","runId":"f6000000-0000-4000-8000-0000000000ac","startedAt":"2026-10-05T08:00:00.000Z","finishedAt":"2026-10-05T08:05:00.000Z","evalSet":{"setId":"fixture-pilot","version":1,"caseSchema":1,"checksum":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","activeCases":100,"retiredCases":0,"byType":{"direct":84,"multi_chunk":0,"historical":3,"conflict":2,"unanswerable":5,"distractor":3,"permission":3,"filter":0},"bySplit":{"dev":100,"holdout":0}},"gateSet":{"id":"gates","version":1,"decision":"B-020","method":"hybrid","k":8,"checksum":"b573b331ee808054289f7bb44ae5ffe0471a1be68fd266cdc45a3b5d19349149"},"configuration":{"label":"fixture-bedrock","adapter":"fixture-evaluation","environment":"evaluation","declared":{"embedding":{"provider":"aws-bedrock","model":"cohere.embed-v4:0","modelVersion":"eu-1024-v1","dimensions":1024,"processing":{"kind":"geographic","geography":"EU","sourceRegion":"eu-central-1","inferenceProfile":"eu.cohere.embed-v4:0"},"settings":{"embeddingType":"float","outputDimension":1024,"truncate":"NONE","inputTypeDocument":"search_document","inputTypeQuery":"search_query"}},"reranker":{"provider":"aws-bedrock","model":"cohere.rerank-v3-5:0","modelVersion":"euc1-v1","id":"aws-bedrock:cohere.rerank-v3-5:0","version":"euc1-v1","processing":{"kind":"in_region","region":"eu-central-1"},"settings":{"apiVersion":2,"topN":"all","document":"heading-path+text","ties":"candidate-order"}},"algorithmVersion":"hybrid-rrf-1","params":{"candidateK":50,"rerankN":30,"topK":8,"maxPerVersion":3,"minScore":0.1,"rrfK":60},"chunkerVersions":["structure/1"]},"declaredFingerprint":"b8387050bf3167c008dd86cfaf5a6c4cad72e919519dc21a18efe99c149e7efc","runtime":{"embedding":{"provider":"aws-bedrock","model":"cohere.embed-v4:0","modelVersion":"eu-1024-v1","dimensions":1024,"processing":{"kind":"geographic","geography":"EU","sourceRegion":"eu-central-1","inferenceProfile":"eu.cohere.embed-v4:0"},"settings":{"embeddingType":"float","outputDimension":1024,"truncate":"NONE","inputTypeDocument":"search_document","inputTypeQuery":"search_query"}},"reranker":{"provider":"aws-bedrock","model":"cohere.rerank-v3-5:0","modelVersion":"euc1-v1","id":"aws-bedrock:cohere.rerank-v3-5:0","version":"euc1-v1","processing":{"kind":"in_region","region":"eu-central-1"},"settings":{"apiVersion":2,"topN":"all","document":"heading-path+text","ties":"candidate-order"}},"algorithmVersion":"hybrid-rrf-1","params":{"candidateK":50,"rerankN":30,"topK":8,"maxPerVersion":3,"minScore":0.1,"rrfK":60},"chunkerVersions":["structure/1"]},"runtimeFingerprint":"b8387050bf3167c008dd86cfaf5a6c4cad72e919519dc21a18efe99c149e7efc","matches":true},"corpus":{"checksumBefore":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","checksumAfter":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","documentTypes":["terms"],"scope":[{"documentType":"terms","productId":"fa000000-0000-4000-8000-000000000001","productName":"Fiktivt erhvervsansvar"},{"documentType":"terms","productId":"fa000000-0000-4000-8000-000000000002","productName":"Testprodukt (fiktiv)"}]},"metrics":{"source_recall_at_k":{"value":1,"numerator":92,"denominator":92,"interval":{"lower":0.9599186107143782,"upper":1}},"passage_recall_at_k":{"value":1,"numerator":92,"denominator":92,"interval":{"lower":0.9599186107143782,"upper":1}},"mrr_at_k":{"value":1,"numerator":null,"denominator":92,"interval":null},"correct_abstention":{"value":1,"numerator":8,"denominator":8,"interval":{"lower":0.6755924351161198,"upper":1}},"false_abstention":{"value":0,"numerator":0,"denominator":92,"interval":{"lower":0,"upper":0.04008138928562172}},"distractor_intrusion":{"value":0,"numerator":0,"denominator":36,"interval":{"lower":0,"upper":0.09641862859446367}},"informational":{"source_recall_at_1":{"value":1,"numerator":92,"denominator":92,"interval":{"lower":0.9599186107143782,"upper":1}},"source_recall_at_3":{"value":1,"numerator":92,"denominator":92,"interval":{"lower":0.9599186107143782,"upper":1}},"full_coverage_at_k":{"value":1,"numerator":null,"denominator":92,"interval":null},"ndcg_at_k":{"value":1,"numerator":null,"denominator":92,"interval":null}}},"rerankerComparison":{"available":true,"withReranker":{"passage_recall_at_k":1,"mrr_at_k":1},"withoutReranker":{"passage_recall_at_k":1,"mrr_at_k":1}},"hardGates":[{"id":"H1","status":"pass","violations":0},{"id":"H2","status":"pass","violations":0},{"id":"H3","status":"pass","violations":0},{"id":"H4","status":"pass","violations":0},{"id":"H5","status":"pass","violations":0},{"id":"H6","status":"pass","violations":0},{"id":"H7","status":"pass","violations":0}],"qualityGates":[{"id":"Q1","metric":"source_recall_at_k","comparator":">=","threshold":0.95,"value":1,"status":"pass","uncertain":false,"explanation":"1.000 ≥ 0.950 (92/92), 95 %-interval [0.960; 1.000]."},{"id":"Q2","metric":"passage_recall_at_k","comparator":">=","threshold":0.85,"value":1,"status":"pass","uncertain":false,"explanation":"1.000 ≥ 0.850 (92/92), 95 %-interval [0.960; 1.000]."},{"id":"Q3","metric":"mrr_at_k","comparator":">=","threshold":0.7,"value":1,"status":"pass","uncertain":false,"explanation":"1.000 ≥ 0.700 (n = 92)."},{"id":"Q4","metric":"correct_abstention","comparator":">=","threshold":0.8,"value":1,"status":"pass","uncertain":true,"explanation":"1.000 ≥ 0.800 (8/8), 95 %-interval [0.676; 1.000]."},{"id":"Q5","metric":"false_abstention","comparator":"<=","threshold":0.1,"value":0,"status":"pass","uncertain":false,"explanation":"0.000 ≤ 0.100 (0/92), 95 %-interval [0.000; 0.040]."},{"id":"Q6","metric":"distractor_intrusion","comparator":"<=","threshold":0.1,"value":0,"status":"pass","uncertain":false,"explanation":"0.000 ≤ 0.100 (0/36), 95 %-interval [0.000; 0.096]."},{"id":"Q7","metric":"reranker_uplift","comparator":"not_lower","threshold":null,"value":0,"status":"pass","uncertain":false,"explanation":"Med reranker: Passage Recall 1.000, MRR 1.000. Uden: 1.000, 1.000."}],"minimums":[{"label":"besvarbare (direct og multi_chunk)","minimum":20,"actual":84,"met":true},{"label":"ubesvarbare","minimum":5,"actual":5,"met":true},{"label":"historiske","minimum":3,"actual":3,"met":true},{"label":"konflikt","minimum":2,"actual":2,"met":true},{"label":"distraktor","minimum":3,"actual":3,"met":true},{"label":"adgang eller filter","minimum":3,"actual":3,"met":true}],"tier":"standard","verdict":"uncertain","valid":true,"invalidReasons":[],"failures":[],"cases":[{"caseId":"direct-001","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-002","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-003","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-004","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-005","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-006","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-007","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-008","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-009","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-010","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-011","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-012","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-013","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-014","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-015","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-016","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-017","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-018","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-019","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-020","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-021","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-022","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-023","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-024","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-025","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-026","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-027","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-028","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-029","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-030","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-031","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-032","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-033","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-034","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-035","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-036","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-037","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-038","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-039","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-040","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-041","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-042","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-043","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-044","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-045","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-046","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-047","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-048","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-049","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-050","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-051","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-052","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-053","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-054","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-055","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-056","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-057","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-058","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-059","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-060","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-061","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-062","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-063","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-064","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-065","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-066","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-067","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-068","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-069","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-070","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-071","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-072","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-073","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-074","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-075","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-076","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-077","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-078","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-079","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-080","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-081","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-082","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-083","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-084","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"historical-001","type":"historical","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"historical-002","type":"historical","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"historical-003","type":"historical","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"conflict-001","type":"conflict","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"conflict-002","type":"conflict","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"unanswerable-001","type":"unanswerable","split":"dev","outcome":"insufficient","itemCount":0,"empty":true,"sourceRank":null,"firstGrade3Rank":null,"requiredCovered":0,"requiredTotal":0,"gainsByRank":[],"idealGains":[],"itemsWithinK":0,"distractorItems":0,"violations":[],"error":null},{"caseId":"unanswerable-002","type":"unanswerable","split":"dev","outcome":"insufficient","itemCount":0,"empty":true,"sourceRank":null,"firstGrade3Rank":null,"requiredCovered":0,"requiredTotal":0,"gainsByRank":[],"idealGains":[],"itemsWithinK":0,"distractorItems":0,"violations":[],"error":null},{"caseId":"unanswerable-003","type":"unanswerable","split":"dev","outcome":"insufficient","itemCount":0,"empty":true,"sourceRank":null,"firstGrade3Rank":null,"requiredCovered":0,"requiredTotal":0,"gainsByRank":[],"idealGains":[],"itemsWithinK":0,"distractorItems":0,"violations":[],"error":null},{"caseId":"unanswerable-004","type":"unanswerable","split":"dev","outcome":"insufficient","itemCount":0,"empty":true,"sourceRank":null,"firstGrade3Rank":null,"requiredCovered":0,"requiredTotal":0,"gainsByRank":[],"idealGains":[],"itemsWithinK":0,"distractorItems":0,"violations":[],"error":null},{"caseId":"unanswerable-005","type":"unanswerable","split":"dev","outcome":"insufficient","itemCount":0,"empty":true,"sourceRank":null,"firstGrade3Rank":null,"requiredCovered":0,"requiredTotal":0,"gainsByRank":[],"idealGains":[],"itemsWithinK":0,"distractorItems":0,"violations":[],"error":null},{"caseId":"distractor-001","type":"distractor","split":"dev","outcome":"evidence","itemCount":12,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":12,"distractorItems":0,"violations":[],"error":null},{"caseId":"distractor-002","type":"distractor","split":"dev","outcome":"evidence","itemCount":12,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":12,"distractorItems":0,"violations":[],"error":null},{"caseId":"distractor-003","type":"distractor","split":"dev","outcome":"evidence","itemCount":12,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":12,"distractorItems":0,"violations":[],"error":null},{"caseId":"permission-001","type":"permission","split":"dev","outcome":"insufficient","itemCount":0,"empty":true,"sourceRank":null,"firstGrade3Rank":null,"requiredCovered":0,"requiredTotal":0,"gainsByRank":[],"idealGains":[],"itemsWithinK":0,"distractorItems":0,"violations":[],"error":null},{"caseId":"permission-002","type":"permission","split":"dev","outcome":"insufficient","itemCount":0,"empty":true,"sourceRank":null,"firstGrade3Rank":null,"requiredCovered":0,"requiredTotal":0,"gainsByRank":[],"idealGains":[],"itemsWithinK":0,"distractorItems":0,"violations":[],"error":null},{"caseId":"permission-003","type":"permission","split":"dev","outcome":"insufficient","itemCount":0,"empty":true,"sourceRank":null,"firstGrade3Rank":null,"requiredCovered":0,"requiredTotal":0,"gainsByRank":[],"idealGains":[],"itemsWithinK":0,"distractorItems":0,"violations":[],"error":null}],"production":{"eligible":false,"reason":"En rapport er data og erklærer aldrig sig selv production-egnet. Kun evaluation_publisher kan registrere den (knowledge.record_evaluation_run), og kun et menneske med system.settings.manage kan derefter godkende og aktivere konfigurationen. Evidensens grad afgøres af P1–P9 ved hvert retrieval (docs/08b §9–§10)."},"checksums":{"results":"7f99c1f271b265004a90f1ea8992209fabfb859ccbf9efd7d98b34e4171a62fc","report":"29d7890fe8ea75f9db7f4b48aafe40f16fef0da1ebcb02185664a63f21dbca94"}}$uncertainstandard$::jsonb $f$;
create function pg_temp.ts_quality_regression() returns jsonb language sql immutable as $f$ select $qualityregression${"reportSchema":6,"kind":"retrieval-evaluation","engine":"beta-L1.1/6","runId":"f6000000-0000-4000-8000-0000000000ad","startedAt":"2026-10-05T08:00:00.000Z","finishedAt":"2026-10-05T08:05:00.000Z","evalSet":{"setId":"fixture-pilot","version":1,"caseSchema":1,"checksum":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","activeCases":36,"retiredCases":0,"byType":{"direct":20,"multi_chunk":0,"historical":3,"conflict":2,"unanswerable":5,"distractor":3,"permission":3,"filter":0},"bySplit":{"dev":36,"holdout":0}},"gateSet":{"id":"gates","version":1,"decision":"B-020","method":"hybrid","k":8,"checksum":"b573b331ee808054289f7bb44ae5ffe0471a1be68fd266cdc45a3b5d19349149"},"configuration":{"label":"fixture-bedrock","adapter":"fixture-evaluation","environment":"evaluation","declared":{"embedding":{"provider":"aws-bedrock","model":"cohere.embed-v4:0","modelVersion":"eu-1024-v1","dimensions":1024,"processing":{"kind":"geographic","geography":"EU","sourceRegion":"eu-central-1","inferenceProfile":"eu.cohere.embed-v4:0"},"settings":{"embeddingType":"float","outputDimension":1024,"truncate":"NONE","inputTypeDocument":"search_document","inputTypeQuery":"search_query"}},"reranker":{"provider":"aws-bedrock","model":"cohere.rerank-v3-5:0","modelVersion":"euc1-v1","id":"aws-bedrock:cohere.rerank-v3-5:0","version":"euc1-v1","processing":{"kind":"in_region","region":"eu-central-1"},"settings":{"apiVersion":2,"topN":"all","document":"heading-path+text","ties":"candidate-order"}},"algorithmVersion":"hybrid-rrf-1","params":{"candidateK":50,"rerankN":30,"topK":8,"maxPerVersion":3,"minScore":0.1,"rrfK":60},"chunkerVersions":["structure/1"]},"declaredFingerprint":"b8387050bf3167c008dd86cfaf5a6c4cad72e919519dc21a18efe99c149e7efc","runtime":{"embedding":{"provider":"aws-bedrock","model":"cohere.embed-v4:0","modelVersion":"eu-1024-v1","dimensions":1024,"processing":{"kind":"geographic","geography":"EU","sourceRegion":"eu-central-1","inferenceProfile":"eu.cohere.embed-v4:0"},"settings":{"embeddingType":"float","outputDimension":1024,"truncate":"NONE","inputTypeDocument":"search_document","inputTypeQuery":"search_query"}},"reranker":{"provider":"aws-bedrock","model":"cohere.rerank-v3-5:0","modelVersion":"euc1-v1","id":"aws-bedrock:cohere.rerank-v3-5:0","version":"euc1-v1","processing":{"kind":"in_region","region":"eu-central-1"},"settings":{"apiVersion":2,"topN":"all","document":"heading-path+text","ties":"candidate-order"}},"algorithmVersion":"hybrid-rrf-1","params":{"candidateK":50,"rerankN":30,"topK":8,"maxPerVersion":3,"minScore":0.1,"rrfK":60},"chunkerVersions":["structure/1"]},"runtimeFingerprint":"b8387050bf3167c008dd86cfaf5a6c4cad72e919519dc21a18efe99c149e7efc","matches":true},"corpus":{"checksumBefore":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","checksumAfter":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","documentTypes":["terms"],"scope":[{"documentType":"terms","productId":"fa000000-0000-4000-8000-000000000001","productName":"Fiktivt erhvervsansvar"},{"documentType":"terms","productId":"fa000000-0000-4000-8000-000000000002","productName":"Testprodukt (fiktiv)"}]},"metrics":{"source_recall_at_k":{"value":0.2857142857142857,"numerator":8,"denominator":28,"interval":{"lower":0.1525399605666909,"upper":0.47059288433295715}},"passage_recall_at_k":{"value":0.2857142857142857,"numerator":8,"denominator":28,"interval":{"lower":0.1525399605666909,"upper":0.47059288433295715}},"mrr_at_k":{"value":0.2857142857142857,"numerator":null,"denominator":28,"interval":null},"correct_abstention":{"value":1,"numerator":8,"denominator":8,"interval":{"lower":0.6755924351161198,"upper":1}},"false_abstention":{"value":0,"numerator":0,"denominator":28,"interval":{"lower":0,"upper":0.12064330476584563}},"distractor_intrusion":{"value":0,"numerator":0,"denominator":36,"interval":{"lower":0,"upper":0.09641862859446367}},"informational":{"source_recall_at_1":{"value":0.2857142857142857,"numerator":8,"denominator":28,"interval":{"lower":0.1525399605666909,"upper":0.47059288433295715}},"source_recall_at_3":{"value":0.2857142857142857,"numerator":8,"denominator":28,"interval":{"lower":0.1525399605666909,"upper":0.47059288433295715}},"full_coverage_at_k":{"value":0.2857142857142857,"numerator":null,"denominator":28,"interval":null},"ndcg_at_k":{"value":1,"numerator":null,"denominator":28,"interval":null}}},"rerankerComparison":{"available":true,"withReranker":{"passage_recall_at_k":0.2857142857142857,"mrr_at_k":0.2857142857142857},"withoutReranker":{"passage_recall_at_k":0.2857142857142857,"mrr_at_k":0.2857142857142857}},"hardGates":[{"id":"H1","status":"pass","violations":0},{"id":"H2","status":"pass","violations":0},{"id":"H3","status":"pass","violations":0},{"id":"H4","status":"pass","violations":0},{"id":"H5","status":"pass","violations":0},{"id":"H6","status":"pass","violations":0},{"id":"H7","status":"pass","violations":0}],"qualityGates":[{"id":"Q1","metric":"source_recall_at_k","comparator":">=","threshold":0.95,"value":0.2857142857142857,"status":"fail","uncertain":true,"explanation":"0.286 ≥ 0.950 (8/28), 95 %-interval [0.153; 0.471]."},{"id":"Q2","metric":"passage_recall_at_k","comparator":">=","threshold":0.85,"value":0.2857142857142857,"status":"fail","uncertain":true,"explanation":"0.286 ≥ 0.850 (8/28), 95 %-interval [0.153; 0.471]."},{"id":"Q3","metric":"mrr_at_k","comparator":">=","threshold":0.7,"value":0.2857142857142857,"status":"fail","uncertain":false,"explanation":"0.286 ≥ 0.700 (n = 28)."},{"id":"Q4","metric":"correct_abstention","comparator":">=","threshold":0.8,"value":1,"status":"pass","uncertain":true,"explanation":"1.000 ≥ 0.800 (8/8), 95 %-interval [0.676; 1.000]."},{"id":"Q5","metric":"false_abstention","comparator":"<=","threshold":0.1,"value":0,"status":"pass","uncertain":true,"explanation":"0.000 ≤ 0.100 (0/28), 95 %-interval [0.000; 0.121]."},{"id":"Q6","metric":"distractor_intrusion","comparator":"<=","threshold":0.1,"value":0,"status":"pass","uncertain":false,"explanation":"0.000 ≤ 0.100 (0/36), 95 %-interval [0.000; 0.096]."},{"id":"Q7","metric":"reranker_uplift","comparator":"not_lower","threshold":null,"value":0,"status":"pass","uncertain":false,"explanation":"Med reranker: Passage Recall 0.286, MRR 0.286. Uden: 0.286, 0.286."}],"minimums":[{"label":"besvarbare (direct og multi_chunk)","minimum":20,"actual":20,"met":true},{"label":"ubesvarbare","minimum":5,"actual":5,"met":true},{"label":"historiske","minimum":3,"actual":3,"met":true},{"label":"konflikt","minimum":2,"actual":2,"met":true},{"label":"distraktor","minimum":3,"actual":3,"met":true},{"label":"adgang eller filter","minimum":3,"actual":3,"met":true}],"tier":"pilot","verdict":"fail","valid":true,"invalidReasons":[],"failures":[{"caseId":"direct-001","gate":"Q1","explanation":"Ingen forventet dokumentversion blandt de første K elementer.","rootCauseNote":null},{"caseId":"direct-001","gate":"Q2","explanation":"0 af 1 påkrævede passager (grad 3) er dækket blandt de første K elementer.","rootCauseNote":null},{"caseId":"direct-002","gate":"Q1","explanation":"Ingen forventet dokumentversion blandt de første K elementer.","rootCauseNote":null},{"caseId":"direct-002","gate":"Q2","explanation":"0 af 1 påkrævede passager (grad 3) er dækket blandt de første K elementer.","rootCauseNote":null},{"caseId":"direct-003","gate":"Q1","explanation":"Ingen forventet dokumentversion blandt de første K elementer.","rootCauseNote":null},{"caseId":"direct-003","gate":"Q2","explanation":"0 af 1 påkrævede passager (grad 3) er dækket blandt de første K elementer.","rootCauseNote":null},{"caseId":"direct-004","gate":"Q1","explanation":"Ingen forventet dokumentversion blandt de første K elementer.","rootCauseNote":null},{"caseId":"direct-004","gate":"Q2","explanation":"0 af 1 påkrævede passager (grad 3) er dækket blandt de første K elementer.","rootCauseNote":null},{"caseId":"direct-005","gate":"Q1","explanation":"Ingen forventet dokumentversion blandt de første K elementer.","rootCauseNote":null},{"caseId":"direct-005","gate":"Q2","explanation":"0 af 1 påkrævede passager (grad 3) er dækket blandt de første K elementer.","rootCauseNote":null},{"caseId":"direct-006","gate":"Q1","explanation":"Ingen forventet dokumentversion blandt de første K elementer.","rootCauseNote":null},{"caseId":"direct-006","gate":"Q2","explanation":"0 af 1 påkrævede passager (grad 3) er dækket blandt de første K elementer.","rootCauseNote":null},{"caseId":"direct-007","gate":"Q1","explanation":"Ingen forventet dokumentversion blandt de første K elementer.","rootCauseNote":null},{"caseId":"direct-007","gate":"Q2","explanation":"0 af 1 påkrævede passager (grad 3) er dækket blandt de første K elementer.","rootCauseNote":null},{"caseId":"direct-008","gate":"Q1","explanation":"Ingen forventet dokumentversion blandt de første K elementer.","rootCauseNote":null},{"caseId":"direct-008","gate":"Q2","explanation":"0 af 1 påkrævede passager (grad 3) er dækket blandt de første K elementer.","rootCauseNote":null},{"caseId":"direct-009","gate":"Q1","explanation":"Ingen forventet dokumentversion blandt de første K elementer.","rootCauseNote":null},{"caseId":"direct-009","gate":"Q2","explanation":"0 af 1 påkrævede passager (grad 3) er dækket blandt de første K elementer.","rootCauseNote":null},{"caseId":"direct-010","gate":"Q1","explanation":"Ingen forventet dokumentversion blandt de første K elementer.","rootCauseNote":null},{"caseId":"direct-010","gate":"Q2","explanation":"0 af 1 påkrævede passager (grad 3) er dækket blandt de første K elementer.","rootCauseNote":null},{"caseId":"direct-011","gate":"Q1","explanation":"Ingen forventet dokumentversion blandt de første K elementer.","rootCauseNote":null},{"caseId":"direct-011","gate":"Q2","explanation":"0 af 1 påkrævede passager (grad 3) er dækket blandt de første K elementer.","rootCauseNote":null},{"caseId":"direct-012","gate":"Q1","explanation":"Ingen forventet dokumentversion blandt de første K elementer.","rootCauseNote":null},{"caseId":"direct-012","gate":"Q2","explanation":"0 af 1 påkrævede passager (grad 3) er dækket blandt de første K elementer.","rootCauseNote":null},{"caseId":"direct-013","gate":"Q1","explanation":"Ingen forventet dokumentversion blandt de første K elementer.","rootCauseNote":null},{"caseId":"direct-013","gate":"Q2","explanation":"0 af 1 påkrævede passager (grad 3) er dækket blandt de første K elementer.","rootCauseNote":null},{"caseId":"direct-014","gate":"Q1","explanation":"Ingen forventet dokumentversion blandt de første K elementer.","rootCauseNote":null},{"caseId":"direct-014","gate":"Q2","explanation":"0 af 1 påkrævede passager (grad 3) er dækket blandt de første K elementer.","rootCauseNote":null},{"caseId":"direct-015","gate":"Q1","explanation":"Ingen forventet dokumentversion blandt de første K elementer.","rootCauseNote":null},{"caseId":"direct-015","gate":"Q2","explanation":"0 af 1 påkrævede passager (grad 3) er dækket blandt de første K elementer.","rootCauseNote":null},{"caseId":"direct-016","gate":"Q1","explanation":"Ingen forventet dokumentversion blandt de første K elementer.","rootCauseNote":null},{"caseId":"direct-016","gate":"Q2","explanation":"0 af 1 påkrævede passager (grad 3) er dækket blandt de første K elementer.","rootCauseNote":null},{"caseId":"direct-017","gate":"Q1","explanation":"Ingen forventet dokumentversion blandt de første K elementer.","rootCauseNote":null},{"caseId":"direct-017","gate":"Q2","explanation":"0 af 1 påkrævede passager (grad 3) er dækket blandt de første K elementer.","rootCauseNote":null},{"caseId":"direct-018","gate":"Q1","explanation":"Ingen forventet dokumentversion blandt de første K elementer.","rootCauseNote":null},{"caseId":"direct-018","gate":"Q2","explanation":"0 af 1 påkrævede passager (grad 3) er dækket blandt de første K elementer.","rootCauseNote":null},{"caseId":"direct-019","gate":"Q1","explanation":"Ingen forventet dokumentversion blandt de første K elementer.","rootCauseNote":null},{"caseId":"direct-019","gate":"Q2","explanation":"0 af 1 påkrævede passager (grad 3) er dækket blandt de første K elementer.","rootCauseNote":null},{"caseId":"direct-020","gate":"Q1","explanation":"Ingen forventet dokumentversion blandt de første K elementer.","rootCauseNote":null},{"caseId":"direct-020","gate":"Q2","explanation":"0 af 1 påkrævede passager (grad 3) er dækket blandt de første K elementer.","rootCauseNote":null}],"cases":[{"caseId":"direct-001","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":null,"firstGrade3Rank":null,"requiredCovered":0,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-002","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":null,"firstGrade3Rank":null,"requiredCovered":0,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-003","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":null,"firstGrade3Rank":null,"requiredCovered":0,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-004","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":null,"firstGrade3Rank":null,"requiredCovered":0,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-005","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":null,"firstGrade3Rank":null,"requiredCovered":0,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-006","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":null,"firstGrade3Rank":null,"requiredCovered":0,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-007","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":null,"firstGrade3Rank":null,"requiredCovered":0,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-008","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":null,"firstGrade3Rank":null,"requiredCovered":0,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-009","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":null,"firstGrade3Rank":null,"requiredCovered":0,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-010","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":null,"firstGrade3Rank":null,"requiredCovered":0,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-011","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":null,"firstGrade3Rank":null,"requiredCovered":0,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-012","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":null,"firstGrade3Rank":null,"requiredCovered":0,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-013","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":null,"firstGrade3Rank":null,"requiredCovered":0,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-014","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":null,"firstGrade3Rank":null,"requiredCovered":0,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-015","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":null,"firstGrade3Rank":null,"requiredCovered":0,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-016","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":null,"firstGrade3Rank":null,"requiredCovered":0,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-017","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":null,"firstGrade3Rank":null,"requiredCovered":0,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-018","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":null,"firstGrade3Rank":null,"requiredCovered":0,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-019","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":null,"firstGrade3Rank":null,"requiredCovered":0,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"direct-020","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":null,"firstGrade3Rank":null,"requiredCovered":0,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"historical-001","type":"historical","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"historical-002","type":"historical","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"historical-003","type":"historical","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"conflict-001","type":"conflict","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"conflict-002","type":"conflict","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null},{"caseId":"unanswerable-001","type":"unanswerable","split":"dev","outcome":"insufficient","itemCount":0,"empty":true,"sourceRank":null,"firstGrade3Rank":null,"requiredCovered":0,"requiredTotal":0,"gainsByRank":[],"idealGains":[],"itemsWithinK":0,"distractorItems":0,"violations":[],"error":null},{"caseId":"unanswerable-002","type":"unanswerable","split":"dev","outcome":"insufficient","itemCount":0,"empty":true,"sourceRank":null,"firstGrade3Rank":null,"requiredCovered":0,"requiredTotal":0,"gainsByRank":[],"idealGains":[],"itemsWithinK":0,"distractorItems":0,"violations":[],"error":null},{"caseId":"unanswerable-003","type":"unanswerable","split":"dev","outcome":"insufficient","itemCount":0,"empty":true,"sourceRank":null,"firstGrade3Rank":null,"requiredCovered":0,"requiredTotal":0,"gainsByRank":[],"idealGains":[],"itemsWithinK":0,"distractorItems":0,"violations":[],"error":null},{"caseId":"unanswerable-004","type":"unanswerable","split":"dev","outcome":"insufficient","itemCount":0,"empty":true,"sourceRank":null,"firstGrade3Rank":null,"requiredCovered":0,"requiredTotal":0,"gainsByRank":[],"idealGains":[],"itemsWithinK":0,"distractorItems":0,"violations":[],"error":null},{"caseId":"unanswerable-005","type":"unanswerable","split":"dev","outcome":"insufficient","itemCount":0,"empty":true,"sourceRank":null,"firstGrade3Rank":null,"requiredCovered":0,"requiredTotal":0,"gainsByRank":[],"idealGains":[],"itemsWithinK":0,"distractorItems":0,"violations":[],"error":null},{"caseId":"distractor-001","type":"distractor","split":"dev","outcome":"evidence","itemCount":12,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":12,"distractorItems":0,"violations":[],"error":null},{"caseId":"distractor-002","type":"distractor","split":"dev","outcome":"evidence","itemCount":12,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":12,"distractorItems":0,"violations":[],"error":null},{"caseId":"distractor-003","type":"distractor","split":"dev","outcome":"evidence","itemCount":12,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":12,"distractorItems":0,"violations":[],"error":null},{"caseId":"permission-001","type":"permission","split":"dev","outcome":"insufficient","itemCount":0,"empty":true,"sourceRank":null,"firstGrade3Rank":null,"requiredCovered":0,"requiredTotal":0,"gainsByRank":[],"idealGains":[],"itemsWithinK":0,"distractorItems":0,"violations":[],"error":null},{"caseId":"permission-002","type":"permission","split":"dev","outcome":"insufficient","itemCount":0,"empty":true,"sourceRank":null,"firstGrade3Rank":null,"requiredCovered":0,"requiredTotal":0,"gainsByRank":[],"idealGains":[],"itemsWithinK":0,"distractorItems":0,"violations":[],"error":null},{"caseId":"permission-003","type":"permission","split":"dev","outcome":"insufficient","itemCount":0,"empty":true,"sourceRank":null,"firstGrade3Rank":null,"requiredCovered":0,"requiredTotal":0,"gainsByRank":[],"idealGains":[],"itemsWithinK":0,"distractorItems":0,"violations":[],"error":null}],"production":{"eligible":false,"reason":"En rapport er data og erklærer aldrig sig selv production-egnet. Kun evaluation_publisher kan registrere den (knowledge.record_evaluation_run), og kun et menneske med system.settings.manage kan derefter godkende og aktivere konfigurationen. Evidensens grad afgøres af P1–P9 ved hvert retrieval (docs/08b §9–§10)."},"checksums":{"results":"1c0ccd502b433227c664c9c1d9e2a4e53ba22e9450dc0185c5a761b0110d3bd8","report":"fb5703f68f885d564ec077c03ec848d5cb373d98c285dfa98dd13bece33ee35d"}}$qualityregression$::jsonb $f$;
create function pg_temp.ts_performance() returns jsonb language sql immutable as $f$ select $performance${"schema":1,"kind":"retrieval-performance","measurementId":"f6000000-0000-4000-8000-0000000000pf","runId":"f6000000-0000-4000-8000-0000000000aa","measuredAt":"2026-10-08T08:00:00.000Z","environment":"evaluation","configurationFingerprint":"0000000000000000000000000000000000000000000000000000000000000000","targets":"performance-targets-v1","retrieval":{"total":[420,610,700,780,815,900,1250,1490,1620,640,590,710],"queryEmbedding":[110,130,95,180,240,310,120,140,160,150,100,90],"search":[40,55,61,48,90,120,70,66,52,49,58,63],"rerank":[]},"ingestion":{"documents":[{"pages":52,"seconds":241},{"pages":3,"seconds":19}],"corpusPages":55,"corpusSeconds":260},"results":[{"target":"retrieval_total_p50","limit":800,"value":710,"status":"met"},{"target":"retrieval_total_p95","limit":1500,"value":1620,"status":"not_met"},{"target":"query_embedding_p95","limit":300,"value":310,"status":"not_met"},{"target":"search_p95","limit":300,"value":120,"status":"met"},{"target":"rerank_p95","limit":500,"value":null,"status":"not_measured"},{"target":"ingestion_50_pages_seconds","limit":300,"value":241,"status":"met"},{"target":"ingestion_corpus_2000_pages_seconds","limit":14400,"value":null,"status":"not_measured"}],"checksum":"5c7f7d698a23237d3ab8eabc9b473da2709532f2d7fdc796cd4b638312de1287"}$performance$::jsonb $f$;
create function pg_temp.ts_gates() returns jsonb language sql immutable as $f$ select $gates${"id":"gates","version":1,"decision":"B-020","description":"De initiale kvalitetsgates Q1–Q7 for 8B (docs/08b §4.4, D-6). Kun tærsklerne er data. Metrik og retning er låst i koden, og de hårde gates H1–H7 er invarianter med nul tolerance, som aldrig står her. Rekalibrering kræver en ny version af filen, en ny versionsstyret baseline og en godkendt beslutning.","k":8,"quality":{"Q1":{"metric":"source_recall_at_k","comparator":">=","threshold":0.95},"Q2":{"metric":"passage_recall_at_k","comparator":">=","threshold":0.85},"Q3":{"metric":"mrr_at_k","comparator":">=","threshold":0.7},"Q4":{"metric":"correct_abstention","comparator":">=","threshold":0.8},"Q5":{"metric":"false_abstention","comparator":"<=","threshold":0.1},"Q6":{"metric":"distractor_intrusion","comparator":"<=","threshold":0.1},"Q7":{"metric":"reranker_uplift","comparator":"not_lower"}}}$gates$::jsonb $f$;
create function pg_temp.ts_doc_report() returns jsonb language sql immutable as $f$ select $docreport${"reportSchema":6,"kind":"retrieval-evaluation","engine":"beta-L1.1/6","runId":"f6000000-0000-4000-8000-0000000000d1","startedAt":"2026-10-05T08:00:00.000Z","finishedAt":"2026-10-05T08:05:00.000Z","evalSet":{"setId":"fixture-pilot","version":1,"caseSchema":1,"checksum":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","activeCases":36,"retiredCases":0,"byType":{"direct":20,"multi_chunk":0,"historical":3,"conflict":2,"unanswerable":5,"distractor":3,"permission":3,"filter":0},"bySplit":{"dev":36,"holdout":0}},"gateSet":{"id":"product-documents-gates","version":1,"decision":"B-036","method":"product_documents","k":null,"checksum":"87b52e785f22c530ab549180780b3d9577caf83e4ed413f98fb62d4f9d1d6baf"},"configuration":{"label":"fixture-product-documents","adapter":"fixture-evaluation","environment":"evaluation","declared":{"method":"product_documents","embedding":null,"reranker":null,"algorithmVersion":"product-documents-1","params":{"maxChars":360000},"chunkerVersions":["structure/1"]},"declaredFingerprint":"30ce6f676ae02f7e065d2a0f7d04dda82494c03de73e0b93d221ab7fc2a76151","runtime":{"method":"product_documents","embedding":null,"reranker":null,"algorithmVersion":"product-documents-1","params":{"maxChars":360000},"chunkerVersions":["structure/1"]},"runtimeFingerprint":"30ce6f676ae02f7e065d2a0f7d04dda82494c03de73e0b93d221ab7fc2a76151","matches":true},"corpus":{"checksumBefore":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","checksumAfter":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","documentTypes":["terms"],"scope":[{"documentType":"terms","productId":"fa000000-0000-4000-8000-000000000001","productName":"Fiktivt erhvervsansvar"},{"documentType":"terms","productId":"fa000000-0000-4000-8000-000000000002","productName":"Testprodukt (fiktiv)"}]},"metrics":{"required_document_coverage":{"value":1,"numerator":28,"denominator":28,"interval":{"lower":0.8793566952341543,"upper":1}},"required_passage_coverage":{"value":1,"numerator":28,"denominator":28,"interval":{"lower":0.8793566952341543,"upper":1}},"full_document_integrity":{"value":1,"numerator":36,"denominator":36,"interval":{"lower":0.9035813714055363,"upper":1}},"valid_version_coverage":{"value":1,"numerator":36,"denominator":36,"interval":{"lower":0.9035813714055363,"upper":1}},"correct_product_scope":{"value":1,"numerator":36,"denominator":36,"interval":{"lower":0.9035813714055363,"upper":1}},"authorized_document_coverage":{"value":1,"numerator":36,"denominator":36,"interval":{"lower":0.9035813714055363,"upper":1}}},"rerankerComparison":null,"hardGates":[{"id":"H1","status":"pass","violations":0},{"id":"H2","status":"pass","violations":0},{"id":"H3","status":"pass","violations":0},{"id":"H4","status":"pass","violations":0},{"id":"H5","status":"pass","violations":0},{"id":"H6","status":"pass","violations":0},{"id":"H7","status":"pass","violations":0}],"qualityGates":[{"id":"D1","metric":"required_document_coverage","comparator":">=","threshold":1,"value":1,"status":"pass","uncertain":false,"explanation":"1.000 ≥ 1.000 (28/28). Invariant: ingen spørgsmål må mangle."},{"id":"D2","metric":"required_passage_coverage","comparator":">=","threshold":1,"value":1,"status":"pass","uncertain":false,"explanation":"1.000 ≥ 1.000 (28/28). Invariant: ingen spørgsmål må mangle."},{"id":"D3","metric":"full_document_integrity","comparator":">=","threshold":1,"value":1,"status":"pass","uncertain":false,"explanation":"1.000 ≥ 1.000 (36/36). Invariant: ingen spørgsmål må mangle."},{"id":"D4","metric":"valid_version_coverage","comparator":">=","threshold":1,"value":1,"status":"pass","uncertain":false,"explanation":"1.000 ≥ 1.000 (36/36). Invariant: ingen spørgsmål må mangle."},{"id":"D5","metric":"correct_product_scope","comparator":">=","threshold":1,"value":1,"status":"pass","uncertain":false,"explanation":"1.000 ≥ 1.000 (36/36). Invariant: ingen spørgsmål må mangle."},{"id":"D6","metric":"authorized_document_coverage","comparator":">=","threshold":1,"value":1,"status":"pass","uncertain":false,"explanation":"1.000 ≥ 1.000 (36/36). Invariant: ingen spørgsmål må mangle."}],"minimums":[{"label":"besvarbare (direct og multi_chunk)","minimum":20,"actual":20,"met":true},{"label":"ubesvarbare","minimum":5,"actual":5,"met":true},{"label":"historiske","minimum":3,"actual":3,"met":true},{"label":"konflikt","minimum":2,"actual":2,"met":true},{"label":"distraktor","minimum":3,"actual":3,"met":true},{"label":"adgang eller filter","minimum":3,"actual":3,"met":true}],"tier":"pilot","verdict":"pass","valid":true,"invalidReasons":[],"failures":[],"cases":[{"caseId":"direct-001","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null,"documents":{"expectedVersions":2,"deliveredVersions":2,"missingVersions":0,"unexpectedVersions":0,"missingDocuments":0,"unexpectedDocuments":0,"incompleteVersions":0,"productQueried":true,"foreignProductItems":0,"requiredDocuments":1,"requiredDocumentsCovered":1,"requiredPassages":1,"requiredPassagesCovered":1}},{"caseId":"direct-002","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null,"documents":{"expectedVersions":2,"deliveredVersions":2,"missingVersions":0,"unexpectedVersions":0,"missingDocuments":0,"unexpectedDocuments":0,"incompleteVersions":0,"productQueried":true,"foreignProductItems":0,"requiredDocuments":1,"requiredDocumentsCovered":1,"requiredPassages":1,"requiredPassagesCovered":1}},{"caseId":"direct-003","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null,"documents":{"expectedVersions":2,"deliveredVersions":2,"missingVersions":0,"unexpectedVersions":0,"missingDocuments":0,"unexpectedDocuments":0,"incompleteVersions":0,"productQueried":true,"foreignProductItems":0,"requiredDocuments":1,"requiredDocumentsCovered":1,"requiredPassages":1,"requiredPassagesCovered":1}},{"caseId":"direct-004","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null,"documents":{"expectedVersions":2,"deliveredVersions":2,"missingVersions":0,"unexpectedVersions":0,"missingDocuments":0,"unexpectedDocuments":0,"incompleteVersions":0,"productQueried":true,"foreignProductItems":0,"requiredDocuments":1,"requiredDocumentsCovered":1,"requiredPassages":1,"requiredPassagesCovered":1}},{"caseId":"direct-005","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null,"documents":{"expectedVersions":2,"deliveredVersions":2,"missingVersions":0,"unexpectedVersions":0,"missingDocuments":0,"unexpectedDocuments":0,"incompleteVersions":0,"productQueried":true,"foreignProductItems":0,"requiredDocuments":1,"requiredDocumentsCovered":1,"requiredPassages":1,"requiredPassagesCovered":1}},{"caseId":"direct-006","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null,"documents":{"expectedVersions":2,"deliveredVersions":2,"missingVersions":0,"unexpectedVersions":0,"missingDocuments":0,"unexpectedDocuments":0,"incompleteVersions":0,"productQueried":true,"foreignProductItems":0,"requiredDocuments":1,"requiredDocumentsCovered":1,"requiredPassages":1,"requiredPassagesCovered":1}},{"caseId":"direct-007","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null,"documents":{"expectedVersions":2,"deliveredVersions":2,"missingVersions":0,"unexpectedVersions":0,"missingDocuments":0,"unexpectedDocuments":0,"incompleteVersions":0,"productQueried":true,"foreignProductItems":0,"requiredDocuments":1,"requiredDocumentsCovered":1,"requiredPassages":1,"requiredPassagesCovered":1}},{"caseId":"direct-008","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null,"documents":{"expectedVersions":2,"deliveredVersions":2,"missingVersions":0,"unexpectedVersions":0,"missingDocuments":0,"unexpectedDocuments":0,"incompleteVersions":0,"productQueried":true,"foreignProductItems":0,"requiredDocuments":1,"requiredDocumentsCovered":1,"requiredPassages":1,"requiredPassagesCovered":1}},{"caseId":"direct-009","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null,"documents":{"expectedVersions":2,"deliveredVersions":2,"missingVersions":0,"unexpectedVersions":0,"missingDocuments":0,"unexpectedDocuments":0,"incompleteVersions":0,"productQueried":true,"foreignProductItems":0,"requiredDocuments":1,"requiredDocumentsCovered":1,"requiredPassages":1,"requiredPassagesCovered":1}},{"caseId":"direct-010","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null,"documents":{"expectedVersions":2,"deliveredVersions":2,"missingVersions":0,"unexpectedVersions":0,"missingDocuments":0,"unexpectedDocuments":0,"incompleteVersions":0,"productQueried":true,"foreignProductItems":0,"requiredDocuments":1,"requiredDocumentsCovered":1,"requiredPassages":1,"requiredPassagesCovered":1}},{"caseId":"direct-011","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null,"documents":{"expectedVersions":2,"deliveredVersions":2,"missingVersions":0,"unexpectedVersions":0,"missingDocuments":0,"unexpectedDocuments":0,"incompleteVersions":0,"productQueried":true,"foreignProductItems":0,"requiredDocuments":1,"requiredDocumentsCovered":1,"requiredPassages":1,"requiredPassagesCovered":1}},{"caseId":"direct-012","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null,"documents":{"expectedVersions":2,"deliveredVersions":2,"missingVersions":0,"unexpectedVersions":0,"missingDocuments":0,"unexpectedDocuments":0,"incompleteVersions":0,"productQueried":true,"foreignProductItems":0,"requiredDocuments":1,"requiredDocumentsCovered":1,"requiredPassages":1,"requiredPassagesCovered":1}},{"caseId":"direct-013","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null,"documents":{"expectedVersions":2,"deliveredVersions":2,"missingVersions":0,"unexpectedVersions":0,"missingDocuments":0,"unexpectedDocuments":0,"incompleteVersions":0,"productQueried":true,"foreignProductItems":0,"requiredDocuments":1,"requiredDocumentsCovered":1,"requiredPassages":1,"requiredPassagesCovered":1}},{"caseId":"direct-014","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null,"documents":{"expectedVersions":2,"deliveredVersions":2,"missingVersions":0,"unexpectedVersions":0,"missingDocuments":0,"unexpectedDocuments":0,"incompleteVersions":0,"productQueried":true,"foreignProductItems":0,"requiredDocuments":1,"requiredDocumentsCovered":1,"requiredPassages":1,"requiredPassagesCovered":1}},{"caseId":"direct-015","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null,"documents":{"expectedVersions":2,"deliveredVersions":2,"missingVersions":0,"unexpectedVersions":0,"missingDocuments":0,"unexpectedDocuments":0,"incompleteVersions":0,"productQueried":true,"foreignProductItems":0,"requiredDocuments":1,"requiredDocumentsCovered":1,"requiredPassages":1,"requiredPassagesCovered":1}},{"caseId":"direct-016","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null,"documents":{"expectedVersions":2,"deliveredVersions":2,"missingVersions":0,"unexpectedVersions":0,"missingDocuments":0,"unexpectedDocuments":0,"incompleteVersions":0,"productQueried":true,"foreignProductItems":0,"requiredDocuments":1,"requiredDocumentsCovered":1,"requiredPassages":1,"requiredPassagesCovered":1}},{"caseId":"direct-017","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null,"documents":{"expectedVersions":2,"deliveredVersions":2,"missingVersions":0,"unexpectedVersions":0,"missingDocuments":0,"unexpectedDocuments":0,"incompleteVersions":0,"productQueried":true,"foreignProductItems":0,"requiredDocuments":1,"requiredDocumentsCovered":1,"requiredPassages":1,"requiredPassagesCovered":1}},{"caseId":"direct-018","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null,"documents":{"expectedVersions":2,"deliveredVersions":2,"missingVersions":0,"unexpectedVersions":0,"missingDocuments":0,"unexpectedDocuments":0,"incompleteVersions":0,"productQueried":true,"foreignProductItems":0,"requiredDocuments":1,"requiredDocumentsCovered":1,"requiredPassages":1,"requiredPassagesCovered":1}},{"caseId":"direct-019","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null,"documents":{"expectedVersions":2,"deliveredVersions":2,"missingVersions":0,"unexpectedVersions":0,"missingDocuments":0,"unexpectedDocuments":0,"incompleteVersions":0,"productQueried":true,"foreignProductItems":0,"requiredDocuments":1,"requiredDocumentsCovered":1,"requiredPassages":1,"requiredPassagesCovered":1}},{"caseId":"direct-020","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null,"documents":{"expectedVersions":2,"deliveredVersions":2,"missingVersions":0,"unexpectedVersions":0,"missingDocuments":0,"unexpectedDocuments":0,"incompleteVersions":0,"productQueried":true,"foreignProductItems":0,"requiredDocuments":1,"requiredDocumentsCovered":1,"requiredPassages":1,"requiredPassagesCovered":1}},{"caseId":"historical-001","type":"historical","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null,"documents":{"expectedVersions":2,"deliveredVersions":2,"missingVersions":0,"unexpectedVersions":0,"missingDocuments":0,"unexpectedDocuments":0,"incompleteVersions":0,"productQueried":true,"foreignProductItems":0,"requiredDocuments":1,"requiredDocumentsCovered":1,"requiredPassages":1,"requiredPassagesCovered":1}},{"caseId":"historical-002","type":"historical","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null,"documents":{"expectedVersions":2,"deliveredVersions":2,"missingVersions":0,"unexpectedVersions":0,"missingDocuments":0,"unexpectedDocuments":0,"incompleteVersions":0,"productQueried":true,"foreignProductItems":0,"requiredDocuments":1,"requiredDocumentsCovered":1,"requiredPassages":1,"requiredPassagesCovered":1}},{"caseId":"historical-003","type":"historical","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null,"documents":{"expectedVersions":2,"deliveredVersions":2,"missingVersions":0,"unexpectedVersions":0,"missingDocuments":0,"unexpectedDocuments":0,"incompleteVersions":0,"productQueried":true,"foreignProductItems":0,"requiredDocuments":1,"requiredDocumentsCovered":1,"requiredPassages":1,"requiredPassagesCovered":1}},{"caseId":"conflict-001","type":"conflict","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null,"documents":{"expectedVersions":2,"deliveredVersions":2,"missingVersions":0,"unexpectedVersions":0,"missingDocuments":0,"unexpectedDocuments":0,"incompleteVersions":0,"productQueried":true,"foreignProductItems":0,"requiredDocuments":1,"requiredDocumentsCovered":1,"requiredPassages":1,"requiredPassagesCovered":1}},{"caseId":"conflict-002","type":"conflict","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null,"documents":{"expectedVersions":2,"deliveredVersions":2,"missingVersions":0,"unexpectedVersions":0,"missingDocuments":0,"unexpectedDocuments":0,"incompleteVersions":0,"productQueried":true,"foreignProductItems":0,"requiredDocuments":1,"requiredDocumentsCovered":1,"requiredPassages":1,"requiredPassagesCovered":1}},{"caseId":"unanswerable-001","type":"unanswerable","split":"dev","outcome":"insufficient","itemCount":0,"empty":true,"sourceRank":null,"firstGrade3Rank":null,"requiredCovered":0,"requiredTotal":0,"gainsByRank":[],"idealGains":[],"itemsWithinK":0,"distractorItems":0,"violations":[],"error":null,"documents":{"expectedVersions":2,"deliveredVersions":2,"missingVersions":0,"unexpectedVersions":0,"missingDocuments":0,"unexpectedDocuments":0,"incompleteVersions":0,"productQueried":true,"foreignProductItems":0,"requiredDocuments":0,"requiredDocumentsCovered":0,"requiredPassages":0,"requiredPassagesCovered":0}},{"caseId":"unanswerable-002","type":"unanswerable","split":"dev","outcome":"insufficient","itemCount":0,"empty":true,"sourceRank":null,"firstGrade3Rank":null,"requiredCovered":0,"requiredTotal":0,"gainsByRank":[],"idealGains":[],"itemsWithinK":0,"distractorItems":0,"violations":[],"error":null,"documents":{"expectedVersions":2,"deliveredVersions":2,"missingVersions":0,"unexpectedVersions":0,"missingDocuments":0,"unexpectedDocuments":0,"incompleteVersions":0,"productQueried":true,"foreignProductItems":0,"requiredDocuments":0,"requiredDocumentsCovered":0,"requiredPassages":0,"requiredPassagesCovered":0}},{"caseId":"unanswerable-003","type":"unanswerable","split":"dev","outcome":"insufficient","itemCount":0,"empty":true,"sourceRank":null,"firstGrade3Rank":null,"requiredCovered":0,"requiredTotal":0,"gainsByRank":[],"idealGains":[],"itemsWithinK":0,"distractorItems":0,"violations":[],"error":null,"documents":{"expectedVersions":2,"deliveredVersions":2,"missingVersions":0,"unexpectedVersions":0,"missingDocuments":0,"unexpectedDocuments":0,"incompleteVersions":0,"productQueried":true,"foreignProductItems":0,"requiredDocuments":0,"requiredDocumentsCovered":0,"requiredPassages":0,"requiredPassagesCovered":0}},{"caseId":"unanswerable-004","type":"unanswerable","split":"dev","outcome":"insufficient","itemCount":0,"empty":true,"sourceRank":null,"firstGrade3Rank":null,"requiredCovered":0,"requiredTotal":0,"gainsByRank":[],"idealGains":[],"itemsWithinK":0,"distractorItems":0,"violations":[],"error":null,"documents":{"expectedVersions":2,"deliveredVersions":2,"missingVersions":0,"unexpectedVersions":0,"missingDocuments":0,"unexpectedDocuments":0,"incompleteVersions":0,"productQueried":true,"foreignProductItems":0,"requiredDocuments":0,"requiredDocumentsCovered":0,"requiredPassages":0,"requiredPassagesCovered":0}},{"caseId":"unanswerable-005","type":"unanswerable","split":"dev","outcome":"insufficient","itemCount":0,"empty":true,"sourceRank":null,"firstGrade3Rank":null,"requiredCovered":0,"requiredTotal":0,"gainsByRank":[],"idealGains":[],"itemsWithinK":0,"distractorItems":0,"violations":[],"error":null,"documents":{"expectedVersions":2,"deliveredVersions":2,"missingVersions":0,"unexpectedVersions":0,"missingDocuments":0,"unexpectedDocuments":0,"incompleteVersions":0,"productQueried":true,"foreignProductItems":0,"requiredDocuments":0,"requiredDocumentsCovered":0,"requiredPassages":0,"requiredPassagesCovered":0}},{"caseId":"distractor-001","type":"distractor","split":"dev","outcome":"evidence","itemCount":12,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":12,"distractorItems":0,"violations":[],"error":null,"documents":{"expectedVersions":2,"deliveredVersions":2,"missingVersions":0,"unexpectedVersions":0,"missingDocuments":0,"unexpectedDocuments":0,"incompleteVersions":0,"productQueried":true,"foreignProductItems":0,"requiredDocuments":1,"requiredDocumentsCovered":1,"requiredPassages":1,"requiredPassagesCovered":1}},{"caseId":"distractor-002","type":"distractor","split":"dev","outcome":"evidence","itemCount":12,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":12,"distractorItems":0,"violations":[],"error":null,"documents":{"expectedVersions":2,"deliveredVersions":2,"missingVersions":0,"unexpectedVersions":0,"missingDocuments":0,"unexpectedDocuments":0,"incompleteVersions":0,"productQueried":true,"foreignProductItems":0,"requiredDocuments":1,"requiredDocumentsCovered":1,"requiredPassages":1,"requiredPassagesCovered":1}},{"caseId":"distractor-003","type":"distractor","split":"dev","outcome":"evidence","itemCount":12,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":12,"distractorItems":0,"violations":[],"error":null,"documents":{"expectedVersions":2,"deliveredVersions":2,"missingVersions":0,"unexpectedVersions":0,"missingDocuments":0,"unexpectedDocuments":0,"incompleteVersions":0,"productQueried":true,"foreignProductItems":0,"requiredDocuments":1,"requiredDocumentsCovered":1,"requiredPassages":1,"requiredPassagesCovered":1}},{"caseId":"permission-001","type":"permission","split":"dev","outcome":"insufficient","itemCount":0,"empty":true,"sourceRank":null,"firstGrade3Rank":null,"requiredCovered":0,"requiredTotal":0,"gainsByRank":[],"idealGains":[],"itemsWithinK":0,"distractorItems":0,"violations":[],"error":null,"documents":{"expectedVersions":2,"deliveredVersions":2,"missingVersions":0,"unexpectedVersions":0,"missingDocuments":0,"unexpectedDocuments":0,"incompleteVersions":0,"productQueried":true,"foreignProductItems":0,"requiredDocuments":0,"requiredDocumentsCovered":0,"requiredPassages":0,"requiredPassagesCovered":0}},{"caseId":"permission-002","type":"permission","split":"dev","outcome":"insufficient","itemCount":0,"empty":true,"sourceRank":null,"firstGrade3Rank":null,"requiredCovered":0,"requiredTotal":0,"gainsByRank":[],"idealGains":[],"itemsWithinK":0,"distractorItems":0,"violations":[],"error":null,"documents":{"expectedVersions":2,"deliveredVersions":2,"missingVersions":0,"unexpectedVersions":0,"missingDocuments":0,"unexpectedDocuments":0,"incompleteVersions":0,"productQueried":true,"foreignProductItems":0,"requiredDocuments":0,"requiredDocumentsCovered":0,"requiredPassages":0,"requiredPassagesCovered":0}},{"caseId":"permission-003","type":"permission","split":"dev","outcome":"insufficient","itemCount":0,"empty":true,"sourceRank":null,"firstGrade3Rank":null,"requiredCovered":0,"requiredTotal":0,"gainsByRank":[],"idealGains":[],"itemsWithinK":0,"distractorItems":0,"violations":[],"error":null,"documents":{"expectedVersions":2,"deliveredVersions":2,"missingVersions":0,"unexpectedVersions":0,"missingDocuments":0,"unexpectedDocuments":0,"incompleteVersions":0,"productQueried":true,"foreignProductItems":0,"requiredDocuments":0,"requiredDocumentsCovered":0,"requiredPassages":0,"requiredPassagesCovered":0}}],"production":{"eligible":false,"reason":"En rapport er data og erklærer aldrig sig selv production-egnet. Kun evaluation_publisher kan registrere den (knowledge.record_evaluation_run), og kun et menneske med system.settings.manage kan derefter godkende og aktivere konfigurationen. Evidensens grad afgøres af P1–P9 ved hvert retrieval (docs/08b §9–§10)."},"checksums":{"results":"836e9b5ea89d1020a7b33b016ba3add9a30f2ab5baab050aee4ad6904360de6a","report":"6bc1d78b3dbda75ca62e38939875a91417b092f82b5c53a86231e02b7166dc62"}}$docreport$::jsonb $f$;
create function pg_temp.ts_doc_missing() returns jsonb language sql immutable as $f$ select $docmissing${"reportSchema":6,"kind":"retrieval-evaluation","engine":"beta-L1.1/6","runId":"f6000000-0000-4000-8000-0000000000d2","startedAt":"2026-10-05T08:00:00.000Z","finishedAt":"2026-10-05T08:05:00.000Z","evalSet":{"setId":"fixture-pilot","version":1,"caseSchema":1,"checksum":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","activeCases":36,"retiredCases":0,"byType":{"direct":20,"multi_chunk":0,"historical":3,"conflict":2,"unanswerable":5,"distractor":3,"permission":3,"filter":0},"bySplit":{"dev":36,"holdout":0}},"gateSet":{"id":"product-documents-gates","version":1,"decision":"B-036","method":"product_documents","k":null,"checksum":"87b52e785f22c530ab549180780b3d9577caf83e4ed413f98fb62d4f9d1d6baf"},"configuration":{"label":"fixture-product-documents","adapter":"fixture-evaluation","environment":"evaluation","declared":{"method":"product_documents","embedding":null,"reranker":null,"algorithmVersion":"product-documents-1","params":{"maxChars":360000},"chunkerVersions":["structure/1"]},"declaredFingerprint":"30ce6f676ae02f7e065d2a0f7d04dda82494c03de73e0b93d221ab7fc2a76151","runtime":{"method":"product_documents","embedding":null,"reranker":null,"algorithmVersion":"product-documents-1","params":{"maxChars":360000},"chunkerVersions":["structure/1"]},"runtimeFingerprint":"30ce6f676ae02f7e065d2a0f7d04dda82494c03de73e0b93d221ab7fc2a76151","matches":true},"corpus":{"checksumBefore":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","checksumAfter":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","documentTypes":["terms"],"scope":[{"documentType":"terms","productId":"fa000000-0000-4000-8000-000000000001","productName":"Fiktivt erhvervsansvar"},{"documentType":"terms","productId":"fa000000-0000-4000-8000-000000000002","productName":"Testprodukt (fiktiv)"}]},"metrics":{"required_document_coverage":{"value":1,"numerator":28,"denominator":28,"interval":{"lower":0.8793566952341543,"upper":1}},"required_passage_coverage":{"value":1,"numerator":28,"denominator":28,"interval":{"lower":0.8793566952341543,"upper":1}},"full_document_integrity":{"value":1,"numerator":36,"denominator":36,"interval":{"lower":0.9035813714055363,"upper":1}},"valid_version_coverage":{"value":0.9722222222222222,"numerator":35,"denominator":36,"interval":{"lower":0.8583028134672614,"upper":0.9950795928601897}},"correct_product_scope":{"value":1,"numerator":36,"denominator":36,"interval":{"lower":0.9035813714055363,"upper":1}},"authorized_document_coverage":{"value":1,"numerator":36,"denominator":36,"interval":{"lower":0.9035813714055363,"upper":1}}},"rerankerComparison":null,"hardGates":[{"id":"H1","status":"pass","violations":0},{"id":"H2","status":"pass","violations":0},{"id":"H3","status":"pass","violations":0},{"id":"H4","status":"pass","violations":0},{"id":"H5","status":"pass","violations":0},{"id":"H6","status":"pass","violations":0},{"id":"H7","status":"pass","violations":0}],"qualityGates":[{"id":"D1","metric":"required_document_coverage","comparator":">=","threshold":1,"value":1,"status":"pass","uncertain":false,"explanation":"1.000 ≥ 1.000 (28/28). Invariant: ingen spørgsmål må mangle."},{"id":"D2","metric":"required_passage_coverage","comparator":">=","threshold":1,"value":1,"status":"pass","uncertain":false,"explanation":"1.000 ≥ 1.000 (28/28). Invariant: ingen spørgsmål må mangle."},{"id":"D3","metric":"full_document_integrity","comparator":">=","threshold":1,"value":1,"status":"pass","uncertain":false,"explanation":"1.000 ≥ 1.000 (36/36). Invariant: ingen spørgsmål må mangle."},{"id":"D4","metric":"valid_version_coverage","comparator":">=","threshold":1,"value":0.9722222222222222,"status":"fail","uncertain":false,"explanation":"0.972 ≥ 1.000 (35/36). Invariant: ingen spørgsmål må mangle."},{"id":"D5","metric":"correct_product_scope","comparator":">=","threshold":1,"value":1,"status":"pass","uncertain":false,"explanation":"1.000 ≥ 1.000 (36/36). Invariant: ingen spørgsmål må mangle."},{"id":"D6","metric":"authorized_document_coverage","comparator":">=","threshold":1,"value":1,"status":"pass","uncertain":false,"explanation":"1.000 ≥ 1.000 (36/36). Invariant: ingen spørgsmål må mangle."}],"minimums":[{"label":"besvarbare (direct og multi_chunk)","minimum":20,"actual":20,"met":true},{"label":"ubesvarbare","minimum":5,"actual":5,"met":true},{"label":"historiske","minimum":3,"actual":3,"met":true},{"label":"konflikt","minimum":2,"actual":2,"met":true},{"label":"distraktor","minimum":3,"actual":3,"met":true},{"label":"adgang eller filter","minimum":3,"actual":3,"met":true}],"tier":"pilot","verdict":"fail","valid":true,"invalidReasons":[],"failures":[{"caseId":"direct-001","gate":"D4","explanation":"1 gyldig(e) version(er) mangler, 0 uventet(e) er leveret.","rootCauseNote":null}],"cases":[{"caseId":"direct-001","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null,"documents":{"expectedVersions":2,"deliveredVersions":1,"missingVersions":1,"unexpectedVersions":0,"missingDocuments":0,"unexpectedDocuments":0,"incompleteVersions":0,"productQueried":true,"foreignProductItems":0,"requiredDocuments":1,"requiredDocumentsCovered":1,"requiredPassages":1,"requiredPassagesCovered":1}},{"caseId":"direct-002","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null,"documents":{"expectedVersions":2,"deliveredVersions":2,"missingVersions":0,"unexpectedVersions":0,"missingDocuments":0,"unexpectedDocuments":0,"incompleteVersions":0,"productQueried":true,"foreignProductItems":0,"requiredDocuments":1,"requiredDocumentsCovered":1,"requiredPassages":1,"requiredPassagesCovered":1}},{"caseId":"direct-003","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null,"documents":{"expectedVersions":2,"deliveredVersions":2,"missingVersions":0,"unexpectedVersions":0,"missingDocuments":0,"unexpectedDocuments":0,"incompleteVersions":0,"productQueried":true,"foreignProductItems":0,"requiredDocuments":1,"requiredDocumentsCovered":1,"requiredPassages":1,"requiredPassagesCovered":1}},{"caseId":"direct-004","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null,"documents":{"expectedVersions":2,"deliveredVersions":2,"missingVersions":0,"unexpectedVersions":0,"missingDocuments":0,"unexpectedDocuments":0,"incompleteVersions":0,"productQueried":true,"foreignProductItems":0,"requiredDocuments":1,"requiredDocumentsCovered":1,"requiredPassages":1,"requiredPassagesCovered":1}},{"caseId":"direct-005","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null,"documents":{"expectedVersions":2,"deliveredVersions":2,"missingVersions":0,"unexpectedVersions":0,"missingDocuments":0,"unexpectedDocuments":0,"incompleteVersions":0,"productQueried":true,"foreignProductItems":0,"requiredDocuments":1,"requiredDocumentsCovered":1,"requiredPassages":1,"requiredPassagesCovered":1}},{"caseId":"direct-006","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null,"documents":{"expectedVersions":2,"deliveredVersions":2,"missingVersions":0,"unexpectedVersions":0,"missingDocuments":0,"unexpectedDocuments":0,"incompleteVersions":0,"productQueried":true,"foreignProductItems":0,"requiredDocuments":1,"requiredDocumentsCovered":1,"requiredPassages":1,"requiredPassagesCovered":1}},{"caseId":"direct-007","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null,"documents":{"expectedVersions":2,"deliveredVersions":2,"missingVersions":0,"unexpectedVersions":0,"missingDocuments":0,"unexpectedDocuments":0,"incompleteVersions":0,"productQueried":true,"foreignProductItems":0,"requiredDocuments":1,"requiredDocumentsCovered":1,"requiredPassages":1,"requiredPassagesCovered":1}},{"caseId":"direct-008","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null,"documents":{"expectedVersions":2,"deliveredVersions":2,"missingVersions":0,"unexpectedVersions":0,"missingDocuments":0,"unexpectedDocuments":0,"incompleteVersions":0,"productQueried":true,"foreignProductItems":0,"requiredDocuments":1,"requiredDocumentsCovered":1,"requiredPassages":1,"requiredPassagesCovered":1}},{"caseId":"direct-009","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null,"documents":{"expectedVersions":2,"deliveredVersions":2,"missingVersions":0,"unexpectedVersions":0,"missingDocuments":0,"unexpectedDocuments":0,"incompleteVersions":0,"productQueried":true,"foreignProductItems":0,"requiredDocuments":1,"requiredDocumentsCovered":1,"requiredPassages":1,"requiredPassagesCovered":1}},{"caseId":"direct-010","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null,"documents":{"expectedVersions":2,"deliveredVersions":2,"missingVersions":0,"unexpectedVersions":0,"missingDocuments":0,"unexpectedDocuments":0,"incompleteVersions":0,"productQueried":true,"foreignProductItems":0,"requiredDocuments":1,"requiredDocumentsCovered":1,"requiredPassages":1,"requiredPassagesCovered":1}},{"caseId":"direct-011","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null,"documents":{"expectedVersions":2,"deliveredVersions":2,"missingVersions":0,"unexpectedVersions":0,"missingDocuments":0,"unexpectedDocuments":0,"incompleteVersions":0,"productQueried":true,"foreignProductItems":0,"requiredDocuments":1,"requiredDocumentsCovered":1,"requiredPassages":1,"requiredPassagesCovered":1}},{"caseId":"direct-012","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null,"documents":{"expectedVersions":2,"deliveredVersions":2,"missingVersions":0,"unexpectedVersions":0,"missingDocuments":0,"unexpectedDocuments":0,"incompleteVersions":0,"productQueried":true,"foreignProductItems":0,"requiredDocuments":1,"requiredDocumentsCovered":1,"requiredPassages":1,"requiredPassagesCovered":1}},{"caseId":"direct-013","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null,"documents":{"expectedVersions":2,"deliveredVersions":2,"missingVersions":0,"unexpectedVersions":0,"missingDocuments":0,"unexpectedDocuments":0,"incompleteVersions":0,"productQueried":true,"foreignProductItems":0,"requiredDocuments":1,"requiredDocumentsCovered":1,"requiredPassages":1,"requiredPassagesCovered":1}},{"caseId":"direct-014","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null,"documents":{"expectedVersions":2,"deliveredVersions":2,"missingVersions":0,"unexpectedVersions":0,"missingDocuments":0,"unexpectedDocuments":0,"incompleteVersions":0,"productQueried":true,"foreignProductItems":0,"requiredDocuments":1,"requiredDocumentsCovered":1,"requiredPassages":1,"requiredPassagesCovered":1}},{"caseId":"direct-015","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null,"documents":{"expectedVersions":2,"deliveredVersions":2,"missingVersions":0,"unexpectedVersions":0,"missingDocuments":0,"unexpectedDocuments":0,"incompleteVersions":0,"productQueried":true,"foreignProductItems":0,"requiredDocuments":1,"requiredDocumentsCovered":1,"requiredPassages":1,"requiredPassagesCovered":1}},{"caseId":"direct-016","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null,"documents":{"expectedVersions":2,"deliveredVersions":2,"missingVersions":0,"unexpectedVersions":0,"missingDocuments":0,"unexpectedDocuments":0,"incompleteVersions":0,"productQueried":true,"foreignProductItems":0,"requiredDocuments":1,"requiredDocumentsCovered":1,"requiredPassages":1,"requiredPassagesCovered":1}},{"caseId":"direct-017","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null,"documents":{"expectedVersions":2,"deliveredVersions":2,"missingVersions":0,"unexpectedVersions":0,"missingDocuments":0,"unexpectedDocuments":0,"incompleteVersions":0,"productQueried":true,"foreignProductItems":0,"requiredDocuments":1,"requiredDocumentsCovered":1,"requiredPassages":1,"requiredPassagesCovered":1}},{"caseId":"direct-018","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null,"documents":{"expectedVersions":2,"deliveredVersions":2,"missingVersions":0,"unexpectedVersions":0,"missingDocuments":0,"unexpectedDocuments":0,"incompleteVersions":0,"productQueried":true,"foreignProductItems":0,"requiredDocuments":1,"requiredDocumentsCovered":1,"requiredPassages":1,"requiredPassagesCovered":1}},{"caseId":"direct-019","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null,"documents":{"expectedVersions":2,"deliveredVersions":2,"missingVersions":0,"unexpectedVersions":0,"missingDocuments":0,"unexpectedDocuments":0,"incompleteVersions":0,"productQueried":true,"foreignProductItems":0,"requiredDocuments":1,"requiredDocumentsCovered":1,"requiredPassages":1,"requiredPassagesCovered":1}},{"caseId":"direct-020","type":"direct","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null,"documents":{"expectedVersions":2,"deliveredVersions":2,"missingVersions":0,"unexpectedVersions":0,"missingDocuments":0,"unexpectedDocuments":0,"incompleteVersions":0,"productQueried":true,"foreignProductItems":0,"requiredDocuments":1,"requiredDocumentsCovered":1,"requiredPassages":1,"requiredPassagesCovered":1}},{"caseId":"historical-001","type":"historical","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null,"documents":{"expectedVersions":2,"deliveredVersions":2,"missingVersions":0,"unexpectedVersions":0,"missingDocuments":0,"unexpectedDocuments":0,"incompleteVersions":0,"productQueried":true,"foreignProductItems":0,"requiredDocuments":1,"requiredDocumentsCovered":1,"requiredPassages":1,"requiredPassagesCovered":1}},{"caseId":"historical-002","type":"historical","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null,"documents":{"expectedVersions":2,"deliveredVersions":2,"missingVersions":0,"unexpectedVersions":0,"missingDocuments":0,"unexpectedDocuments":0,"incompleteVersions":0,"productQueried":true,"foreignProductItems":0,"requiredDocuments":1,"requiredDocumentsCovered":1,"requiredPassages":1,"requiredPassagesCovered":1}},{"caseId":"historical-003","type":"historical","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null,"documents":{"expectedVersions":2,"deliveredVersions":2,"missingVersions":0,"unexpectedVersions":0,"missingDocuments":0,"unexpectedDocuments":0,"incompleteVersions":0,"productQueried":true,"foreignProductItems":0,"requiredDocuments":1,"requiredDocumentsCovered":1,"requiredPassages":1,"requiredPassagesCovered":1}},{"caseId":"conflict-001","type":"conflict","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null,"documents":{"expectedVersions":2,"deliveredVersions":2,"missingVersions":0,"unexpectedVersions":0,"missingDocuments":0,"unexpectedDocuments":0,"incompleteVersions":0,"productQueried":true,"foreignProductItems":0,"requiredDocuments":1,"requiredDocumentsCovered":1,"requiredPassages":1,"requiredPassagesCovered":1}},{"caseId":"conflict-002","type":"conflict","split":"dev","outcome":"evidence","itemCount":1,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":1,"distractorItems":0,"violations":[],"error":null,"documents":{"expectedVersions":2,"deliveredVersions":2,"missingVersions":0,"unexpectedVersions":0,"missingDocuments":0,"unexpectedDocuments":0,"incompleteVersions":0,"productQueried":true,"foreignProductItems":0,"requiredDocuments":1,"requiredDocumentsCovered":1,"requiredPassages":1,"requiredPassagesCovered":1}},{"caseId":"unanswerable-001","type":"unanswerable","split":"dev","outcome":"insufficient","itemCount":0,"empty":true,"sourceRank":null,"firstGrade3Rank":null,"requiredCovered":0,"requiredTotal":0,"gainsByRank":[],"idealGains":[],"itemsWithinK":0,"distractorItems":0,"violations":[],"error":null,"documents":{"expectedVersions":2,"deliveredVersions":2,"missingVersions":0,"unexpectedVersions":0,"missingDocuments":0,"unexpectedDocuments":0,"incompleteVersions":0,"productQueried":true,"foreignProductItems":0,"requiredDocuments":0,"requiredDocumentsCovered":0,"requiredPassages":0,"requiredPassagesCovered":0}},{"caseId":"unanswerable-002","type":"unanswerable","split":"dev","outcome":"insufficient","itemCount":0,"empty":true,"sourceRank":null,"firstGrade3Rank":null,"requiredCovered":0,"requiredTotal":0,"gainsByRank":[],"idealGains":[],"itemsWithinK":0,"distractorItems":0,"violations":[],"error":null,"documents":{"expectedVersions":2,"deliveredVersions":2,"missingVersions":0,"unexpectedVersions":0,"missingDocuments":0,"unexpectedDocuments":0,"incompleteVersions":0,"productQueried":true,"foreignProductItems":0,"requiredDocuments":0,"requiredDocumentsCovered":0,"requiredPassages":0,"requiredPassagesCovered":0}},{"caseId":"unanswerable-003","type":"unanswerable","split":"dev","outcome":"insufficient","itemCount":0,"empty":true,"sourceRank":null,"firstGrade3Rank":null,"requiredCovered":0,"requiredTotal":0,"gainsByRank":[],"idealGains":[],"itemsWithinK":0,"distractorItems":0,"violations":[],"error":null,"documents":{"expectedVersions":2,"deliveredVersions":2,"missingVersions":0,"unexpectedVersions":0,"missingDocuments":0,"unexpectedDocuments":0,"incompleteVersions":0,"productQueried":true,"foreignProductItems":0,"requiredDocuments":0,"requiredDocumentsCovered":0,"requiredPassages":0,"requiredPassagesCovered":0}},{"caseId":"unanswerable-004","type":"unanswerable","split":"dev","outcome":"insufficient","itemCount":0,"empty":true,"sourceRank":null,"firstGrade3Rank":null,"requiredCovered":0,"requiredTotal":0,"gainsByRank":[],"idealGains":[],"itemsWithinK":0,"distractorItems":0,"violations":[],"error":null,"documents":{"expectedVersions":2,"deliveredVersions":2,"missingVersions":0,"unexpectedVersions":0,"missingDocuments":0,"unexpectedDocuments":0,"incompleteVersions":0,"productQueried":true,"foreignProductItems":0,"requiredDocuments":0,"requiredDocumentsCovered":0,"requiredPassages":0,"requiredPassagesCovered":0}},{"caseId":"unanswerable-005","type":"unanswerable","split":"dev","outcome":"insufficient","itemCount":0,"empty":true,"sourceRank":null,"firstGrade3Rank":null,"requiredCovered":0,"requiredTotal":0,"gainsByRank":[],"idealGains":[],"itemsWithinK":0,"distractorItems":0,"violations":[],"error":null,"documents":{"expectedVersions":2,"deliveredVersions":2,"missingVersions":0,"unexpectedVersions":0,"missingDocuments":0,"unexpectedDocuments":0,"incompleteVersions":0,"productQueried":true,"foreignProductItems":0,"requiredDocuments":0,"requiredDocumentsCovered":0,"requiredPassages":0,"requiredPassagesCovered":0}},{"caseId":"distractor-001","type":"distractor","split":"dev","outcome":"evidence","itemCount":12,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":12,"distractorItems":0,"violations":[],"error":null,"documents":{"expectedVersions":2,"deliveredVersions":2,"missingVersions":0,"unexpectedVersions":0,"missingDocuments":0,"unexpectedDocuments":0,"incompleteVersions":0,"productQueried":true,"foreignProductItems":0,"requiredDocuments":1,"requiredDocumentsCovered":1,"requiredPassages":1,"requiredPassagesCovered":1}},{"caseId":"distractor-002","type":"distractor","split":"dev","outcome":"evidence","itemCount":12,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":12,"distractorItems":0,"violations":[],"error":null,"documents":{"expectedVersions":2,"deliveredVersions":2,"missingVersions":0,"unexpectedVersions":0,"missingDocuments":0,"unexpectedDocuments":0,"incompleteVersions":0,"productQueried":true,"foreignProductItems":0,"requiredDocuments":1,"requiredDocumentsCovered":1,"requiredPassages":1,"requiredPassagesCovered":1}},{"caseId":"distractor-003","type":"distractor","split":"dev","outcome":"evidence","itemCount":12,"empty":false,"sourceRank":1,"firstGrade3Rank":1,"requiredCovered":1,"requiredTotal":1,"gainsByRank":[3],"idealGains":[3],"itemsWithinK":12,"distractorItems":0,"violations":[],"error":null,"documents":{"expectedVersions":2,"deliveredVersions":2,"missingVersions":0,"unexpectedVersions":0,"missingDocuments":0,"unexpectedDocuments":0,"incompleteVersions":0,"productQueried":true,"foreignProductItems":0,"requiredDocuments":1,"requiredDocumentsCovered":1,"requiredPassages":1,"requiredPassagesCovered":1}},{"caseId":"permission-001","type":"permission","split":"dev","outcome":"insufficient","itemCount":0,"empty":true,"sourceRank":null,"firstGrade3Rank":null,"requiredCovered":0,"requiredTotal":0,"gainsByRank":[],"idealGains":[],"itemsWithinK":0,"distractorItems":0,"violations":[],"error":null,"documents":{"expectedVersions":2,"deliveredVersions":2,"missingVersions":0,"unexpectedVersions":0,"missingDocuments":0,"unexpectedDocuments":0,"incompleteVersions":0,"productQueried":true,"foreignProductItems":0,"requiredDocuments":0,"requiredDocumentsCovered":0,"requiredPassages":0,"requiredPassagesCovered":0}},{"caseId":"permission-002","type":"permission","split":"dev","outcome":"insufficient","itemCount":0,"empty":true,"sourceRank":null,"firstGrade3Rank":null,"requiredCovered":0,"requiredTotal":0,"gainsByRank":[],"idealGains":[],"itemsWithinK":0,"distractorItems":0,"violations":[],"error":null,"documents":{"expectedVersions":2,"deliveredVersions":2,"missingVersions":0,"unexpectedVersions":0,"missingDocuments":0,"unexpectedDocuments":0,"incompleteVersions":0,"productQueried":true,"foreignProductItems":0,"requiredDocuments":0,"requiredDocumentsCovered":0,"requiredPassages":0,"requiredPassagesCovered":0}},{"caseId":"permission-003","type":"permission","split":"dev","outcome":"insufficient","itemCount":0,"empty":true,"sourceRank":null,"firstGrade3Rank":null,"requiredCovered":0,"requiredTotal":0,"gainsByRank":[],"idealGains":[],"itemsWithinK":0,"distractorItems":0,"violations":[],"error":null,"documents":{"expectedVersions":2,"deliveredVersions":2,"missingVersions":0,"unexpectedVersions":0,"missingDocuments":0,"unexpectedDocuments":0,"incompleteVersions":0,"productQueried":true,"foreignProductItems":0,"requiredDocuments":0,"requiredDocumentsCovered":0,"requiredPassages":0,"requiredPassagesCovered":0}}],"production":{"eligible":false,"reason":"En rapport er data og erklærer aldrig sig selv production-egnet. Kun evaluation_publisher kan registrere den (knowledge.record_evaluation_run), og kun et menneske med system.settings.manage kan derefter godkende og aktivere konfigurationen. Evidensens grad afgøres af P1–P9 ved hvert retrieval (docs/08b §9–§10)."},"checksums":{"results":"0101f4b5a7ded9d842f4053e4727608ee9a6028d258bfa5b7ab2cab001a00395","report":"c2f624ff2130e8511cab8e515e63e380ddf8c327ffdae8c910110dc01a991765"}}$docmissing$::jsonb $f$;
create function pg_temp.ts_doc_gates() returns jsonb language sql immutable as $f$ select $docgates${"id":"product-documents-gates","version":1,"decision":"B-036","method":"product_documents","description":"Kvalitetsgates D1–D6 for retrieval-metoden product_documents (docs/beta.md §5.1, B-036). Metoden leverer hele produktets dokumentgrundlag og rangerer ikke, så Q1–Q7 gælder ikke for den. Hver gate er en invariant med tærsklen 1: intet spørgsmål må mangle. Metrik, retning og tærskel er låst i koden. De hårde gates H1–H7 er invarianter med nul tolerance og står aldrig her. Gate-sættet kan kun evaluere og dermed godkende en product_documents-konfiguration.","quality":{"D1":{"metric":"required_document_coverage","comparator":">=","threshold":1},"D2":{"metric":"required_passage_coverage","comparator":">=","threshold":1},"D3":{"metric":"full_document_integrity","comparator":">=","threshold":1},"D4":{"metric":"valid_version_coverage","comparator":">=","threshold":1},"D5":{"metric":"correct_product_scope","comparator":">=","threshold":1},"D6":{"metric":"authorized_document_coverage","comparator":">=","threshold":1}}}$docgates$::jsonb $f$;

-- En forfalsker med algoritmen: genberegner checksums efter en ændring.
create function pg_temp.reseal(r jsonb) returns jsonb language plpgsql as $f$
declare
  v jsonb := r;
begin
  v := jsonb_set(v, '{checksums,results}', to_jsonb(knowledge.checksum_of(jsonb_build_object(
    'metrics', v -> 'metrics', 'rerankerComparison', v -> 'rerankerComparison', 'hardGates', v -> 'hardGates',
    'qualityGates', v -> 'qualityGates', 'minimums', v -> 'minimums', 'tier', v -> 'tier', 'verdict', v -> 'verdict',
    'valid', v -> 'valid', 'invalidReasons', v -> 'invalidReasons', 'failures', v -> 'failures', 'cases', v -> 'cases'))));
  return jsonb_set(v, '{checksums,report}', to_jsonb(knowledge.checksum_of(
    (v - 'checksums') || jsonb_build_object('checksums', jsonb_build_object('results', v #> '{checksums,results}')))));
end $f$;

create function pg_temp.with_run(r jsonb, p_run text) returns jsonb language sql as $f$
  select pg_temp.reseal(jsonb_set(r, '{runId}', to_jsonb(p_run)))
$f$;

-- Samme rapport for en anden konfiguration (materiale), som en ny kørsel.
create function pg_temp.with_material(r jsonb, m jsonb, p_run text) returns jsonb language sql as $f$
  select pg_temp.reseal(
    jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(r, '{configuration,declared}', m), '{configuration,runtime}', m),
      '{configuration,declaredFingerprint}', to_jsonb(knowledge.retrieval_fingerprint(m))),
      '{configuration,runtimeFingerprint}', to_jsonb(knowledge.retrieval_fingerprint(m))), '{runId}', to_jsonb(p_run)))
$f$;

-- Testens egne identiteter, så registret (der aldrig tømmes) kan indeholde andre rækker:
-- et eget gate-sæt-id, en egen model-version, et eget label og et unikt run-id.
create temp table pgtap_ids as select gen_random_uuid()::text as run;
grant select on pgtap_ids to public;
create function pg_temp.gates() returns jsonb language sql stable as $f$
  select jsonb_set(pg_temp.ts_gates(), '{id}', '"pgtap-gates"')
$f$;
-- En TypeScript-rapport tilpasset testens identiteter: gate-sæt, model, label, evalueret område
-- (testens eget produkt) og en konfiguration, der adskilles på minScore.
create function pg_temp.adapt(r jsonb, p_min_score numeric, p_run text) returns jsonb language sql stable as $f$
  select pg_temp.with_material(
    jsonb_set(jsonb_set(jsonb_set(r, '{configuration,label}', '"pgtap-bedrock"'),
      '{gateSet}', (r -> 'gateSet') || jsonb_build_object('id', 'pgtap-gates', 'checksum', knowledge.checksum_of(pg_temp.gates()))),
      '{corpus,scope}', '[{"documentType":"terms","productId":"62000000-0000-4000-a000-000000000001","productName":"pgTAP Registerprodukt"}]'),
    jsonb_set(jsonb_set(r #> '{configuration,declared}', '{embedding,modelVersion}', '"pgtap-1024-v1"'), '{params,minScore}', to_jsonb(p_min_score)),
    p_run)
$f$;
create function pg_temp.base_report() returns jsonb language sql stable as $f$
  select pg_temp.adapt(pg_temp.ts_report(), 0.1, (select run from pgtap_ids))
$f$;

create function pg_temp.material(p_path text[], p_value jsonb) returns jsonb language sql as $f$
  select jsonb_set(pg_temp.base_report() #> '{configuration,declared}', p_path, p_value)
$f$;

-- En regressionskørsel med ét brud på H1 (en ellers bestået rapport).
create function pg_temp.with_h1_breach(r jsonb, p_run text) returns jsonb language sql as $f$
  select pg_temp.with_run(
    jsonb_set(jsonb_set(jsonb_set(jsonb_set(r,
      '{cases,0,violations}', '[{"gate":"H1","caseId":"direct-001","explanation":"pgTAP: fiktivt brud"}]'),
      '{failures}', '[{"caseId":"direct-001","gate":"H1","explanation":"pgTAP: fiktivt brud","rootCauseNote":null}]'),
      '{hardGates,0}', '{"id":"H1","status":"fail","violations":1}'),
      '{verdict}', '"fail"'),
    p_run)
$f$;

-- Evalueret som én konfiguration, kørt som en anden (H6 på kørselsniveau), som runner.ts skriver det.
create function pg_temp.with_h6_breach(r jsonb) returns jsonb language sql as $f$
  select pg_temp.reseal(
    jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(r,
      '{configuration,runtime}', jsonb_set(r #> '{configuration,declared}', '{params,topK}', '3')),
      '{configuration,runtimeFingerprint}', to_jsonb(knowledge.retrieval_fingerprint(jsonb_set(r #> '{configuration,declared}', '{params,topK}', '3')))),
      '{configuration,matches}', 'false'),
      '{failures}', '[{"caseId":null,"gate":"H6","explanation":"pgTAP: runtime er ikke den evaluerede","rootCauseNote":null}]'),
      '{hardGates,5}', '{"id":"H6","status":"fail","violations":1}'),
      '{valid}', 'false'),
      '{verdict}', '"fail"'))
$f$;

create function pg_temp.publish(r jsonb) returns uuid language plpgsql as $f$
declare v uuid;
begin
  set local role evaluation_publisher_login;
  v := knowledge.record_evaluation_run(r);
  reset role;
  return v;
end $f$;

create function pg_temp.register_gates(g jsonb) returns uuid language plpgsql as $f$
declare v uuid;
begin
  set local role evaluation_publisher_login;
  v := knowledge.register_evaluation_gate_set(g);
  reset role;
  return v;
end $f$;

create function pg_temp.as_user(p_auth uuid) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_auth, 'role', 'authenticated')::text, true);
end $f$;

create function pg_temp.cfg(p_label text, p_version int default 1) returns uuid language sql stable as $f$
  select id from knowledge.retrieval_configurations where label = p_label and version = p_version
$f$;

-- 8B-I5: en fixture-version består sikkerhedskontrollen (som postgres, efter tilstandsmaskinen).
create function pg_temp.release(p_version uuid) returns void language plpgsql as $release$
declare v_verdict uuid;
begin
  insert into knowledge.security_verdicts (document_version_id, policy_version, checksum_sha256, byte_size, detected_mime,
    object_bucket, object_path, structural_result, malware_result, scanner_engine, scanner_version, signature_version,
    signature_time, pdf_security_result, active_content_result, final_verdict, released_at)
  select v.id, 'pdf-v1', v.checksum_sha256, coalesce(v.byte_size, 0), 'application/pdf', 'knowledge-originals', v.storage_path,
         'pass', 'clean', 'development-fixture', '0', '0', now(), 'pass', 'pass', 'safe', now()
  from knowledge.document_versions v where v.id = p_version
  returning id into v_verdict;
  update knowledge.document_versions set security_state = 'scanning' where id = p_version;
  update knowledge.document_versions
  set security_state = 'released', storage_bucket = 'knowledge-originals', security_verdict_id = v_verdict, security_released_at = now()
  where id = p_version;
end $release$;

-- ----------------------------------------------------------------------------
-- Fiktive data. Andre versioner og modeller tages ud af betragtning i transaktionen.
-- ----------------------------------------------------------------------------

insert into auth.users (id, email, aud, role, raw_user_meta_data) values
  ('60000000-0000-4000-a000-000000000001', 'r.admin@ipa.test', 'authenticated', 'authenticated', '{"display_name":"pgTAP Administrator"}'),
  ('60000000-0000-4000-a000-000000000002', 'r.adv@ipa.test', 'authenticated', 'authenticated', '{"display_name":"pgTAP Rådgiver"}');
insert into identity.user_roles (user_id, role_id)
select u.id, r.id from identity.users u join identity.roles r
  on r.key = case when u.auth_id = '60000000-0000-4000-a000-000000000001' then 'administrator' else 'advisor' end
where u.auth_id in ('60000000-0000-4000-a000-000000000001', '60000000-0000-4000-a000-000000000002');

update knowledge.document_versions set status = 'processed' where status = 'under_review';
update knowledge.document_versions set status = 'discarded' where status in ('processed', 'rejected');
update knowledge.document_versions set status = 'withdrawn', withdrawn_at = now(), withdrawal_category = 'other',
  withdrawal_reason = 'pgTAP-isolation' where status = 'published';

-- Bedrock-modellen (kandidat) og et publiceret dokument med chunker-version structure/1.
insert into knowledge.embedding_models (id, provider, model_name, model_version, dimensions, status)
values ('61000000-0000-4000-a000-000000000001', 'aws-bedrock', 'cohere.embed-v4:0', 'pgtap-1024-v1', 1024, 'candidate');
create temp table pgtap_model as select '61000000-0000-4000-a000-000000000001'::uuid as id;
grant select on pgtap_model to public;
insert into knowledge.embedding_models (id, provider, model_name, model_version, dimensions, status)
values ('61000000-0000-4000-a000-000000000002', 'pgtap', 'uden-konfiguration', '1', 3, 'candidate');

insert into knowledge.products (id, name) values ('62000000-0000-4000-a000-000000000001', 'pgTAP Registerprodukt');
insert into knowledge.documents (id, product_id, document_type, source_id, title)
select '63000000-0000-4000-a000-000000000001', '62000000-0000-4000-a000-000000000001', 'terms', id, 'pgTAP Betingelser'
from knowledge.sources where type = 'manual_upload';
insert into knowledge.documents (id, product_id, document_type, source_id, title)
select '63000000-0000-4000-a000-000000000002', '62000000-0000-4000-a000-000000000001', 'acceptance_rules', id, 'pgTAP Acceptregler'
from knowledge.sources where type = 'manual_upload';
insert into knowledge.document_versions (id, document_id, version_label, valid_from, storage_path, checksum_sha256)
values ('64000000-0000-4000-a000-000000000001', '63000000-0000-4000-a000-000000000001', '1', '2020-01-01', 'r/1.pdf', repeat('7', 64)),
       ('64000000-0000-4000-a000-000000000002', '63000000-0000-4000-a000-000000000002', '1', '2020-01-01', 'r/2.pdf', repeat('8', 64));
select pg_temp.release('64000000-0000-4000-a000-000000000001');
select pg_temp.release('64000000-0000-4000-a000-000000000002');
update knowledge.document_versions set status = 'processing' where id in ('64000000-0000-4000-a000-000000000001', '64000000-0000-4000-a000-000000000002');
insert into knowledge.document_chunks (id, document_version_id, chunk_index, kind, text, heading_path, page_start, page_end,
  char_start, char_end, content_hash, char_count, token_estimate)
values ('65000000-0000-4000-a000-000000000001', '64000000-0000-4000-a000-000000000001', 0, 'prose', 'Fiktiv dækning.', '{}', 1, 1, 0, 15, repeat('9', 64), 15, 4);
update knowledge.document_versions set chunker_version = 'structure/1' where id = '64000000-0000-4000-a000-000000000001';
insert into knowledge.chunk_embeddings (chunk_id, embedding_model_id, embedding, language, input_hash)
select '65000000-0000-4000-a000-000000000001', id, ('[' || array_to_string(array_fill(0.01::numeric, array[1024]), ',') || ']')::extensions.vector, 'da', repeat('a', 64)
from pgtap_model;
update knowledge.document_versions set status = 'processed' where id = '64000000-0000-4000-a000-000000000001';
update knowledge.document_versions set status = 'under_review' where id = '64000000-0000-4000-a000-000000000001';
update knowledge.document_versions set status = 'published', approved_at = now(), published_at = now() where id = '64000000-0000-4000-a000-000000000001';

grant evaluation_publisher_login to postgres with inherit false, set true;
select ops.evaluation_publisher_prepare();

-- ----------------------------------------------------------------------------
-- 1. Roller og rettigheder (D-18): mindst mulige rettigheder, ingen omvej for nogen
-- ----------------------------------------------------------------------------

select ok((select not rolcanlogin and not rolsuper and not rolcreaterole and not rolcreatedb and not rolreplication and not rolbypassrls
           from pg_roles where rolname = 'evaluation_publisher'), 'gruppen evaluation_publisher er NOLOGIN uden særlige attributter');
select ok((select not rolsuper and not rolcreaterole and not rolcreatedb and not rolreplication and not rolbypassrls and rolconnlimit = 2
           from pg_roles where rolname = 'evaluation_publisher_login'), 'login-rollen har ingen særlige attributter og højst 2 forbindelser');
select is(
  (select array_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text collate "C") from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname not in ('pg_catalog', 'information_schema') and n.nspname !~ '^pg_'
     and has_schema_privilege('evaluation_publisher', n.oid, 'USAGE') and has_function_privilege('evaluation_publisher', p.oid, 'EXECUTE')),
  array['knowledge.publish_evaluation_run(jsonb,text)', 'knowledge.record_evaluation_run(jsonb)', 'knowledge.record_performance_measurement(jsonb)',
        'knowledge.register_evaluation_gate_set(jsonb)'],
  'publisheren kan kun køre sine publiceringsfunktioner (kørsler, gate-sæt, fra I7 performance-målinger og fra I7.1 publicering med klassifikation)');
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'knowledge' and c.relkind in ('r', 'v', 'm', 'p')
     and has_table_privilege('evaluation_publisher', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')), 0,
  'publisheren har ingen tabelrettigheder');
select is((ops.evaluation_publisher_status() -> 'violations'), '[]'::jsonb, 'ops.evaluation_publisher_status melder ingen overtrædelser');
select ok(not has_function_privilege(r, 'knowledge.record_evaluation_run(jsonb)', 'EXECUTE')
          and not has_function_privilege(r, 'knowledge.register_evaluation_gate_set(jsonb)', 'EXECUTE'),
          format('%s kan ikke publicere evalueringer', r))
from unnest(array['anon', 'authenticated', 'service_role']) r;
select ok(not has_table_privilege(r, format('knowledge.%I', t), 'INSERT') and not has_table_privilege(r, format('knowledge.%I', t), 'UPDATE')
          and not has_table_privilege(r, format('knowledge.%I', t), 'DELETE') and not has_table_privilege(r, format('knowledge.%I', t), 'TRUNCATE'),
          format('%s kan ikke skrive i %s', r, t))
from unnest(array['authenticated', 'service_role']) r,
     unnest(array['retrieval_configurations', 'evaluation_runs', 'evaluation_gate_sets', 'retrieval_configuration_transitions']) t;
select ok(not has_table_privilege('service_role', 'knowledge.retrieval_configurations', 'SELECT'), 'service_role kan ikke læse registret');
select ok(not has_function_privilege('service_role', f, 'EXECUTE'), format('service_role kan ikke køre %s', f))
from unnest(array['knowledge.retrieval_context()', 'knowledge.approve_retrieval_configuration(uuid,uuid,jsonb)',
                  'knowledge.activate_retrieval_configuration(uuid)', 'knowledge.suspend_retrieval_configuration(uuid,text)',
                  'knowledge.suspend_retrieval_configuration_internal(uuid,text,uuid,text)']) f;
select ok(not has_function_privilege('authenticated', 'knowledge.suspend_retrieval_configuration_internal(uuid,text,uuid,text)', 'EXECUTE'),
  'den interne suspendering kan ikke kaldes af nogen app-rolle');

-- ----------------------------------------------------------------------------
-- 1b. TypeScript og databasen regner ens: den uændrede, genererede rapport efterprøves i SQL
-- ----------------------------------------------------------------------------

select is(knowledge.checksum_of((pg_temp.ts_report() - 'checksums') || jsonb_build_object('checksums', jsonb_build_object('results', pg_temp.ts_report() #> '{checksums,results}'))),
  pg_temp.ts_report() #>> '{checksums,report}', 'rapportens checksum genberegnes identisk i SQL (kanonisk JSON)');
select is(knowledge.retrieval_fingerprint(pg_temp.ts_report() #> '{configuration,declared}'), pg_temp.ts_report() #>> '{configuration,declaredFingerprint}',
  'konfigurationens fingeraftryk genberegnes identisk i SQL');
select is(knowledge.checksum_of(pg_temp.ts_gates()), pg_temp.ts_report() #>> '{gateSet,checksum}', 'gate-sættets checksum genberegnes identisk i SQL');
select is(knowledge.eval_report_problems(pg_temp.ts_report(), pg_temp.ts_gates()), '{}'::text[],
  'metrics, Wilson-intervaller, gates, minimum, tier og afgørelse genberegnes uden afvigelser');

create temp table pgtap_fp as select pg_temp.base_report() #>> '{configuration,declaredFingerprint}' as fp;
grant select on pgtap_fp to public;

-- ----------------------------------------------------------------------------
-- 2. Gate-sættet: registreres af publisheren, godkendes af et menneske, ændres aldrig
-- ----------------------------------------------------------------------------

create temp table pgtap_gate as select pg_temp.register_gates(pg_temp.gates()) as id;
grant select on pgtap_gate to public;
select is((select approved_at from knowledge.evaluation_gate_sets where id = (select id from pgtap_gate)), null, 'et gate-sæt registreres ugodkendt');
select throws_like($$ select pg_temp.publish(pg_temp.base_report()) $$, '%Afvist (gate_set)%', 'en kørsel mod et ugodkendt gate-sæt afvises');
select is(pg_temp.register_gates(pg_temp.gates())::text, (select id from pgtap_gate)::text, 'registreringen er idempotent på checksum');
select throws_like($$ select pg_temp.register_gates(jsonb_set(pg_temp.gates(), '{quality,Q1,threshold}', '0.5')) $$,
  '%Afvist (gate_set)%', 'en ændret tærskel med samme id og version afvises — rekalibrering kræver en ny version');
select throws_like($$ select pg_temp.register_gates(jsonb_set(pg_temp.gates(), '{quality,Q5,comparator}', '">="')) $$,
  '%låste metrik og retning%', 'metrik og retning er låst i koden');

select pg_temp.as_user('60000000-0000-4000-a000-000000000002');
set local role authenticated;
select throws_ok(format($$ select knowledge.approve_evaluation_gate_set(%L) $$, (select id from pgtap_gate)), '42501', null,
  'en rådgiver kan ikke godkende et gate-sæt');
reset role;
select pg_temp.as_user('60000000-0000-4000-a000-000000000001');
set local role authenticated;
select lives_ok(format($$ select knowledge.approve_evaluation_gate_set(%L) $$, (select id from pgtap_gate)),
  'en administrator med system.settings.manage godkender gate-sættet');
select throws_ok($$ update knowledge.evaluation_gate_sets set k = 3 $$, '42501', null, 'administratoren kan ikke rette et gate-sæt direkte');
reset role;
select throws_like($$ select set_config('knowledge.registry_write', 'on', true); update knowledge.evaluation_gate_sets set k = 3 $$,
  '%kan ikke ændres%', 'et godkendt gate-sæt kan ikke ændres — heller ikke af ejeren');
select set_config('knowledge.registry_write', '', true);

-- ----------------------------------------------------------------------------
-- 3. record_evaluation_run genberegner alt og afviser det, der ikke stemmer
-- ----------------------------------------------------------------------------

select throws_like($$ select pg_temp.publish(jsonb_set(pg_temp.base_report(), '{metrics,mrr_at_k,value}', '0.5')) $$,
  '%Afvist (report_checksum)%', 'en rapport, der er ændret efter kørslen, afvises (checksum)');
select throws_like($$ select pg_temp.publish(pg_temp.reseal(jsonb_set(pg_temp.base_report(), '{metrics,source_recall_at_k,value}', '0.99'))) $$,
  '%Afvist (recomputation)%Source Recall%', 'redigerede metrics afvises, også med nye checksums');
select throws_like($$ select pg_temp.publish(pg_temp.reseal(jsonb_set(pg_temp.base_report(), '{cases,0,sourceRank}', 'null'))) $$,
  '%Afvist (recomputation)%', 'ændrede observationer afvises (metrics kan ikke genberegnes)');
select throws_like($$ select pg_temp.publish(pg_temp.reseal(jsonb_set(pg_temp.base_report(), '{qualityGates,0,status}', '"fail"'))) $$,
  '%Afvist (recomputation)%Kvalitetsgate Q1%', 'et redigeret gate-resultat afvises');
select throws_like($$ select pg_temp.publish(pg_temp.reseal(jsonb_set(pg_temp.base_report(), '{verdict}', '"uncertain"'))) $$,
  '%Afvist (recomputation)%Afgørelsen stemmer ikke%', 'en redigeret afgørelse afvises');
select throws_like($$ select pg_temp.publish(pg_temp.reseal(jsonb_set(pg_temp.base_report(), '{tier}', '"standard"'))) $$,
  '%Afvist (recomputation)%Tier%', 'en redigeret tier afvises');
select throws_like($$ select pg_temp.publish(pg_temp.reseal(jsonb_set(pg_temp.base_report(), '{hardGates,0,violations}', '1'))) $$,
  '%Afvist (recomputation)%hårde gates%', 'redigerede hårde gates afvises');
select throws_like($$ select pg_temp.publish(pg_temp.reseal(jsonb_set(pg_temp.base_report(), '{production,eligible}', 'true'))) $$,
  '%Afvist (self_certified)%', 'en rapport kan ikke erklære sig selv production-egnet');
select throws_like($$ select pg_temp.publish(pg_temp.reseal(jsonb_set(pg_temp.base_report(), '{configuration,environment}', '"fixture"'))) $$,
  '%Afvist (invalid_run)%', 'udviklings- eller fixture-evidens kan aldrig registreres (H7)');
select throws_like($$ select pg_temp.publish(pg_temp.reseal(jsonb_set(pg_temp.base_report(), '{configuration,declaredFingerprint}', to_jsonb(repeat('0', 64))))) $$,
  '%Afvist (fingerprint)%', 'et fingeraftryk, der ikke er materialets, afvises');
select throws_like($$ select pg_temp.publish(pg_temp.with_h6_breach(pg_temp.base_report())) $$,
  '%Afvist (invalid_run)%H6%', 'evalueret som A, kørt som B: kørslen dokumenterer ikke konfigurationen og kan ikke registreres (H6)');
select throws_like($$ select pg_temp.publish(pg_temp.with_material(pg_temp.base_report(), pg_temp.material('{reranker,id}', '"none"'), 'run-none')) $$,
  '%Afvist (development)%', 'en konfiguration med "none" kan ikke registreres');
select throws_like($$ select pg_temp.publish(pg_temp.with_material(pg_temp.base_report(), pg_temp.material('{embedding,provider}', '"test"'), 'run-test')) $$,
  '%Afvist (development)%', 'en konfiguration med test-embedderen kan ikke registreres');
select throws_like($$ select pg_temp.publish(pg_temp.with_material(pg_temp.base_report(), pg_temp.material('{embedding,modelVersion}', '"ukendt"'), 'run-model')) $$,
  '%Afvist (model)%', 'en konfiguration med en ukendt embedding-model afvises');
select throws_like($$ select pg_temp.publish(pg_temp.reseal(jsonb_set(pg_temp.base_report(), '{corpus,documentTypes}', '["opfundet"]'))) $$,
  '%Afvist (corpus)%', 'ukendte dokumenttyper i korpusset afvises');
select throws_like($$ select pg_temp.publish(pg_temp.reseal(jsonb_set(pg_temp.base_report(), '{gateSet,checksum}', to_jsonb(repeat('e', 64))))) $$,
  '%Afvist (gate_set)%', 'et gate-sæt, der ikke er registreret, afvises');
select throws_like($$ select pg_temp.publish(pg_temp.reseal(jsonb_set(pg_temp.base_report(), '{reportSchema}', '2'))) $$,
  '%Afvist (format)%', 'kun det understøttede rapportformat accepteres');

select pg_temp.as_user('60000000-0000-4000-a000-000000000001');
set local role authenticated;
select throws_ok($$ select knowledge.record_evaluation_run('{}'::jsonb) $$, '42501', null, 'en administrator kan ikke registrere en kørsel');
reset role;
select throws_ok($$ select knowledge.record_evaluation_run(pg_temp.base_report()) $$, '42501', null, 'heller ikke ejeren uden publisherens identitet');

create temp table pgtap_runs (name text primary key, id uuid);
grant select on pgtap_runs to public;
insert into pgtap_runs select 'a1', pg_temp.publish(pg_temp.base_report());
select pass('en korrekt rapport registreres af evaluation_publisher');
select is((select status from knowledge.retrieval_configurations where id = pg_temp.cfg('pgtap-bedrock')), 'candidate',
  'konfigurationen oprettes som kandidat');
select ok((select passed and tier = 'pilot' and verdict = 'pass' and valid from knowledge.evaluation_runs where id = (select id from pgtap_runs where name = 'a1')),
  'kørslen er bestået, gyldig og pilot (under 100 spørgsmål)');
select is((select evaluated_scope from knowledge.evaluation_runs where id = (select id from pgtap_runs where name = 'a1')),
  '[{"documentType":"terms","productId":"62000000-0000-4000-a000-000000000001","productName":"pgTAP Registerprodukt"}]'::jsonb, 'kørslen husker det evaluerede område: produktets stabile id, navnet dengang og dokumenttypen (8B-I6.2)');
select is((select outcome from knowledge.evaluation_runs where id = (select id from pgtap_runs where name = 'a1')), 'pass', 'en statistisk sikker kørsel har udfaldet pass');
select is((select evaluated_document_types from knowledge.evaluation_runs where id = (select id from pgtap_runs where name = 'a1')), array['terms'],
  'kørslen husker de evaluerede dokumenttyper (pilot-scope)');
select is((select fingerprint from knowledge.retrieval_configurations where id = pg_temp.cfg('pgtap-bedrock')),
  pg_temp.base_report() #>> '{configuration,declaredFingerprint}', 'konfigurationens fingeraftryk er det, TypeScript beregnede');
select throws_like($$ select pg_temp.publish(pg_temp.base_report()) $$, '%Afvist (duplicate)%', 'samme kørsel kan ikke registreres to gange');
select ok(exists (select 1 from audit.audit_log where action = 'knowledge.evaluation_run.published'
                  and details ->> 'report_checksum' = pg_temp.base_report() #>> '{checksums,report}'
                  and details ->> 'fingerprint' = pg_temp.base_report() #>> '{configuration,declaredFingerprint}'),
  'publiceringen auditeres med checksums og fingeraftryk');
select ok(exists (select 1 from audit.audit_log where action = 'knowledge.retrieval_configuration.candidate_created'), 'kandidaten auditeres');

-- ----------------------------------------------------------------------------
-- 4. Ingen kan skrive direkte; tilstandsmaskinen og uforanderligheden holder
-- ----------------------------------------------------------------------------

select pg_temp.as_user('60000000-0000-4000-a000-000000000001');
set local role authenticated;
select throws_ok(format($$ update knowledge.retrieval_configurations set status = 'active' where id = %L $$, pg_temp.cfg('pgtap-bedrock')), '42501', null,
  'administratoren kan ikke sætte status direkte (UPDATE)');
select throws_ok($$ update knowledge.evaluation_runs set verdict = 'pass' $$, '42501', null, 'administratoren kan ikke rette en kørsel');
select throws_ok($$ insert into knowledge.retrieval_configuration_transitions (configuration_id, to_status, actor_role) values (gen_random_uuid(), 'active', 'x') $$,
  '42501', null, 'administratoren kan ikke skrive statushistorik');
select throws_ok(format($$ delete from knowledge.retrieval_configurations where id = %L $$, pg_temp.cfg('pgtap-bedrock')), '42501', null,
  'administratoren kan ikke slette en konfiguration');
reset role;
select throws_like(format($$ update knowledge.retrieval_configurations set status = 'approved' where id = %L $$, pg_temp.cfg('pgtap-bedrock')),
  '%ændres kun gennem dets funktioner%', 'heller ikke ejeren kan ændre status uden om funktionerne');
select throws_like(format($$ select set_config('knowledge.registry_write', 'on', true); update knowledge.retrieval_configurations set material = jsonb_set(material, '{params,topK}', '3') where id = %L $$, pg_temp.cfg('pgtap-bedrock')),
  '%ændres aldrig%', 'materialet er uforanderligt');
select throws_like(format($$ select set_config('knowledge.registry_write', 'on', true); update knowledge.retrieval_configurations set status = 'active', activated_at = now() where id = %L $$, pg_temp.cfg('pgtap-bedrock')),
  '%ikke tilladt%', 'en kandidat kan ikke springe direkte til aktiv');
select throws_like($$ select set_config('knowledge.registry_write', 'on', true); update knowledge.evaluation_runs set verdict = 'pass' $$,
  '%kan ikke ændres eller slettes%', 'en registreret kørsel er append-only — metrics kan ikke rettes bagefter');
select throws_like(format($$ delete from knowledge.retrieval_configurations where id = %L $$, pg_temp.cfg('pgtap-bedrock')),
  '%slettes aldrig%', 'en konfiguration slettes aldrig');
select set_config('knowledge.registry_write', '', true);

-- ----------------------------------------------------------------------------
-- 5. Godkendelse kræver system.settings.manage og en bestået kørsel af netop konfigurationen
-- ----------------------------------------------------------------------------

-- Konfiguration B (andre parametre) registreres også.
insert into pgtap_runs select 'b1', pg_temp.publish(pg_temp.with_material(pg_temp.base_report(),
  jsonb_set(pg_temp.base_report() #> '{configuration,declared}', '{params,minScore}', '0.2'), 'run-b1'));

select pg_temp.as_user('60000000-0000-4000-a000-000000000002');
set local role authenticated;
select throws_ok(format($$ select knowledge.approve_retrieval_configuration(%L, %L, '[]') $$, pg_temp.cfg('pgtap-bedrock'), (select id from pgtap_runs where name = 'a1')),
  '42501', null, 'en rådgiver kan ikke godkende en konfiguration');
select is((select count(*)::int from knowledge.retrieval_configurations), 0, 'en rådgiver kan ikke læse registret');
reset role;

select pg_temp.as_user('60000000-0000-4000-a000-000000000001');
set local role authenticated;
select throws_like(format($$ select knowledge.approve_retrieval_configuration(%L, %L, '[]') $$, pg_temp.cfg('pgtap-bedrock'), (select id from pgtap_runs where name = 'b1')),
  '%kørslen gælder en anden konfiguration%', 'evalueret som B kan ikke godkende A');
select throws_like(format($$ select knowledge.activate_retrieval_configuration(%L) $$, pg_temp.cfg('pgtap-bedrock')),
  '%kun en godkendt konfiguration kan aktiveres%', 'en kandidat kan ikke aktiveres uden godkendelse');
select throws_like($$ select knowledge.activate_embedding_model('61000000-0000-4000-a000-000000000002') $$,
  '%godkendt retrieval-konfiguration%', 'en embedding-model kan ikke aktiveres uden en godkendt konfiguration (§2.7)');
select lives_ok(format($$ select knowledge.approve_retrieval_configuration(%L, %L, '[]') $$, pg_temp.cfg('pgtap-bedrock'), (select id from pgtap_runs where name = 'a1')),
  'administratoren godkender A med dens beståede kørsel');
select is((select count(*)::int from knowledge.retrieval_configurations where status = 'approved'), 1, 'administratoren kan læse historikken');
reset role;
select ok((select status = 'approved' and tier = 'pilot' and approval_run_id = (select id from pgtap_runs where name = 'a1')
                  and approved_by = (select id from identity.users where auth_id = '60000000-0000-4000-a000-000000000001')
           from knowledge.retrieval_configurations where id = pg_temp.cfg('pgtap-bedrock')),
  'godkendelsen registrerer kørslen, tier og den godkendende bruger');
select ok(exists (select 1 from knowledge.retrieval_configuration_transitions where configuration_id = pg_temp.cfg('pgtap-bedrock') and to_status = 'approved'),
  'statusskiftet står i historikken');

-- ----------------------------------------------------------------------------
-- 6. Aktivering i én transaktion, med modelskifte og pilot-scope
-- ----------------------------------------------------------------------------

-- Publiceret indhold uden for det evaluerede område (8B-I6.1): en ikke-evalueret dokumenttype for
-- testens produkt og et helt andet produkt. Det blokerer ikke aktiveringen — området håndhæves
-- pr. element (P3) — men konteksten viser det, og det kan aldrig blive production.
update knowledge.document_versions set status = 'processed' where id = '64000000-0000-4000-a000-000000000002';
update knowledge.document_versions set status = 'under_review' where id = '64000000-0000-4000-a000-000000000002';
update knowledge.document_versions set status = 'published', approved_at = now(), published_at = now() where id = '64000000-0000-4000-a000-000000000002';
insert into knowledge.products (id, name) values ('62000000-0000-4000-a000-000000000002', 'pgTAP Ny produktfamilie');
insert into knowledge.documents (id, product_id, document_type, source_id, title)
select '63000000-0000-4000-a000-000000000003', '62000000-0000-4000-a000-000000000002', 'terms', id, 'pgTAP Ny familie'
from knowledge.sources where type = 'manual_upload';
insert into knowledge.document_versions (id, document_id, version_label, valid_from, storage_path, checksum_sha256)
values ('64000000-0000-4000-a000-000000000004', '63000000-0000-4000-a000-000000000003', '1', '2020-01-01', 'r/4.pdf', repeat('c', 64));
select pg_temp.release('64000000-0000-4000-a000-000000000004');
update knowledge.document_versions set status = 'processing' where id = '64000000-0000-4000-a000-000000000004';
update knowledge.document_versions set status = 'processed' where id = '64000000-0000-4000-a000-000000000004';
update knowledge.document_versions set status = 'under_review' where id = '64000000-0000-4000-a000-000000000004';
update knowledge.document_versions set status = 'published', approved_at = now(), published_at = now() where id = '64000000-0000-4000-a000-000000000004';

select pg_temp.as_user('60000000-0000-4000-a000-000000000001');
set local role authenticated;
select lives_ok(format($$ select knowledge.activate_retrieval_configuration(%L) $$, pg_temp.cfg('pgtap-bedrock')), 'A aktiveres');
select is(knowledge.retrieval_context() #> '{configuration,scope}',
  '{"tier":"pilot","entries":[{"documentType":"terms","productId":"62000000-0000-4000-a000-000000000001","productName":"pgTAP Registerprodukt"}],"documentTypes":["terms"]}'::jsonb,
  'konteksten bærer det godkendte område: kun de evaluerede par af produkt og dokumenttype (pilot)');
select is(knowledge.retrieval_context() #> '{configuration,scopeGaps}',
  '["pgTAP Ny produktfamilie / terms", "pgTAP Registerprodukt / acceptance_rules"]'::jsonb,
  'et ikke-evalueret produkt og en ikke-evalueret dokumenttype står uden for området — også med samme dokumenttype');
select is(knowledge.retrieval_context() #>> '{configuration,productionReady}', 'true',
  'indhold uden for området blokerer ikke konfigurationen; det håndhæves pr. element (P3)');
reset role;
-- Stabil identitet (8B-I6.2): det evaluerede produkt omdøbes, og et andet produkt overtager det
-- gamle navn. Området følger id'et; historikken bevarer navnet fra evalueringen.
update knowledge.products set name = 'pgTAP Registerprodukt omdøbt' where id = '62000000-0000-4000-a000-000000000001';
update knowledge.products set name = 'pgTAP Registerprodukt' where id = '62000000-0000-4000-a000-000000000002';
select is(knowledge.retrieval_context() #> '{configuration,scopeGaps}',
  '["pgTAP Registerprodukt / terms", "pgTAP Registerprodukt omdøbt / acceptance_rules"]'::jsonb,
  'det omdøbte produkt forbliver i området; et nyt produkt med det gamle navn (andet id) står udenfor');
select is((select evaluated_scope from knowledge.evaluation_runs where id = (select id from pgtap_runs where name = 'a1')),
  '[{"documentType":"terms","productId":"62000000-0000-4000-a000-000000000001","productName":"pgTAP Registerprodukt"}]'::jsonb,
  'en omdøbning omskriver ikke kørslen: id og navnet på evalueringstidspunktet står uændret');
select is((select report #> '{corpus,scope}' from knowledge.evaluation_runs where id = (select id from pgtap_runs where name = 'a1')),
  '[{"documentType":"terms","productId":"62000000-0000-4000-a000-000000000001","productName":"pgTAP Registerprodukt"}]'::jsonb,
  'den gemte rapport forklarer fortsat, hvilket produkt-id og hvilket navn der blev evalueret');
update knowledge.products set name = 'pgTAP Ny produktfamilie' where id = '62000000-0000-4000-a000-000000000002';
update knowledge.products set name = 'pgTAP Registerprodukt' where id = '62000000-0000-4000-a000-000000000001';
update knowledge.document_versions set status = 'withdrawn', withdrawn_at = now(), withdrawal_category = 'other', withdrawal_reason = 'pgTAP'
  where id in ('64000000-0000-4000-a000-000000000002', '64000000-0000-4000-a000-000000000004');
select is((select count(*)::int from knowledge.retrieval_configurations where status = 'active'), 1, 'præcis én konfiguration er aktiv');
select is((select status from knowledge.embedding_models where id = (select id from pgtap_model)), 'active',
  'konfigurationens embedding-model blev aktiv i samme transaktion');
select ok(exists (select 1 from audit.audit_log where action = 'knowledge.retrieval_configuration.activated' and entity_id = pg_temp.cfg('pgtap-bedrock')::text
                  and details ->> 'fingerprint' = pg_temp.base_report() #>> '{configuration,declaredFingerprint}'), 'aktiveringen auditeres');

-- Retrieval-konteksten (P1, P3, P6, P9) som den indloggede rådgiver.
select pg_temp.as_user('60000000-0000-4000-a000-000000000002');
set local role authenticated;
select is(knowledge.retrieval_context() #>> '{configuration,productionReady}', 'true', 'den aktive, godkendte konfiguration er klar til production-evidens');
select is(knowledge.retrieval_context() #>> '{executedAs,role}', 'authenticated', 'konteksten viser, at kaldet kører som den indloggede bruger (P6)');
select is(knowledge.retrieval_context() #>> '{configuration,fingerprint}', (select fp from pgtap_fp), 'konteksten bærer fingeraftrykket (P4, P9)');
select is((knowledge.retrieval_context() -> 'configuration') ? 'grade', false, 'konteksten har ingen grad — graden afledes ved hvert retrieval');
reset role;
select pg_temp.as_user('60000000-0000-4000-a000-000000000001');
set local role authenticated;
select is((select chunker_version from knowledge.search_chunks('dækning', null, null) limit 1), 'structure/1', 'search_chunks returnerer chunker-versionen (P7)');
reset role;

-- Udfasede versioner: P5 og I5 er uændrede — en version uden frigivelse kan ikke publiceres.
insert into knowledge.document_versions (id, document_id, version_label, valid_from, storage_path, checksum_sha256)
values ('64000000-0000-4000-a000-000000000003', '63000000-0000-4000-a000-000000000001', '2', '2021-01-01', 'r/3.pdf', repeat('b', 64));
select throws_like($$ update knowledge.document_versions set status = 'processing' where id = '64000000-0000-4000-a000-000000000003';
                     update knowledge.document_versions set status = 'processed' where id = '64000000-0000-4000-a000-000000000003' $$,
  '%sikkerhedskontrollen%', 'I5 er uændret: en version uden frigivelse kan ikke blive behandlet eller publiceret');

-- ----------------------------------------------------------------------------
-- 7. Udskiftning: B erstatter A atomisk; A kan ikke genaktiveres uden en ny kørsel
-- ----------------------------------------------------------------------------

select pg_temp.as_user('60000000-0000-4000-a000-000000000001');
set local role authenticated;
select lives_ok(format($$ select knowledge.approve_retrieval_configuration(%L, %L, '[]') $$, pg_temp.cfg('pgtap-bedrock', 2), (select id from pgtap_runs where name = 'b1')),
  'B godkendes');
select lives_ok(format($$ select knowledge.activate_retrieval_configuration(%L) $$, pg_temp.cfg('pgtap-bedrock', 2)), 'B aktiveres');
reset role;
select is((select array_agg(status order by version) from knowledge.retrieval_configurations where label = 'pgtap-bedrock'), array['retired', 'active'],
  'A er udfaset og B aktiv — aldrig to aktive');
select is((select retirement_reason from knowledge.retrieval_configurations where id = pg_temp.cfg('pgtap-bedrock')), 'replaced', 'A er erstattet');
select ok(exists (select 1 from audit.audit_log where action = 'knowledge.retrieval_configuration.replaced' and entity_id = pg_temp.cfg('pgtap-bedrock')::text),
  'udskiftningen auditeres');
select pg_temp.as_user('60000000-0000-4000-a000-000000000001');
set local role authenticated;
select throws_like(format($$ select knowledge.activate_retrieval_configuration(%L) $$, pg_temp.cfg('pgtap-bedrock')),
  '%kun en godkendt%', 'en udfaset konfiguration kan ikke genaktiveres direkte');
select throws_like(format($$ select knowledge.approve_retrieval_configuration(%L, %L, '[]') $$, pg_temp.cfg('pgtap-bedrock'), (select id from pgtap_runs where name = 'a1')),
  '%Afvist (reapproval)%', 'genaktivering kræver en ny kørsel efter udfasningen');
reset role;

-- ----------------------------------------------------------------------------
-- 8. Suspendering (D-8): en fejlet hård gate i regression suspenderer straks; ingen fallback
-- ----------------------------------------------------------------------------

insert into pgtap_runs select 'b2', pg_temp.publish(pg_temp.with_h1_breach(pg_temp.with_material(pg_temp.base_report(),
  jsonb_set(pg_temp.base_report() #> '{configuration,declared}', '{params,minScore}', '0.2'), 'x'), 'run-b2'));
select ok((select status = 'suspended' and suspension_reason = 'hard_gate_failed' and suspension_run_id = (select id from pgtap_runs where name = 'b2')
           from knowledge.retrieval_configurations where id = pg_temp.cfg('pgtap-bedrock', 2)),
  'en registreret regressionskørsel med en fejlet hård gate suspenderer B i samme transaktion');
select is((select count(*)::int from knowledge.retrieval_configurations where status = 'active'), 0,
  'ingen automatisk fallback til en anden konfiguration');
select pg_temp.as_user('60000000-0000-4000-a000-000000000002');
set local role authenticated;
select is(knowledge.retrieval_context() #>> '{configuration,productionReady}', 'false', 'den suspenderede konfiguration kan ikke give production-evidens (P3)');
select ok((knowledge.retrieval_context() #> '{configuration,notReady}') ? 'suspended', 'konteksten siger hvorfor');
reset role;
select pg_temp.as_user('60000000-0000-4000-a000-000000000001');
set local role authenticated;
select throws_like(format($$ select knowledge.activate_retrieval_configuration(%L) $$, pg_temp.cfg('pgtap-bedrock', 2)),
  '%kun en godkendt%', 'en suspenderet konfiguration kan ikke aktiveres igen');
select throws_like(format($$ select knowledge.approve_retrieval_configuration(%L, %L, '[]') $$, pg_temp.cfg('pgtap-bedrock', 2), (select id from pgtap_runs where name = 'b1')),
  '%Afvist (reapproval)%', 'den gamle beståede kørsel kan ikke bruges igen efter suspenderingen');
reset role;
insert into pgtap_runs select 'b3', pg_temp.publish(pg_temp.with_material(pg_temp.base_report(),
  jsonb_set(pg_temp.base_report() #> '{configuration,declared}', '{params,minScore}', '0.2'), 'run-b3'));
select pg_temp.as_user('60000000-0000-4000-a000-000000000001');
set local role authenticated;
select lives_ok(format($$ select knowledge.approve_retrieval_configuration(%L, %L, '[]') $$, pg_temp.cfg('pgtap-bedrock', 2), (select id from pgtap_runs where name = 'b3')),
  'en ny bestået kørsel efter suspenderingen kan godkendes');
select lives_ok(format($$ select knowledge.activate_retrieval_configuration(%L) $$, pg_temp.cfg('pgtap-bedrock', 2)), 'og aktiveres igen');
reset role;

-- Manuel suspendering (den operation, I7 også kan bruge via record_evaluation_run).
select pg_temp.as_user('60000000-0000-4000-a000-000000000002');
set local role authenticated;
select throws_ok(format($$ select knowledge.suspend_retrieval_configuration(%L, 'pgTAP: rådgiverens forsøg') $$, pg_temp.cfg('pgtap-bedrock', 2)), '42501', null,
  'en rådgiver kan ikke suspendere');
reset role;
select pg_temp.as_user('60000000-0000-4000-a000-000000000001');
set local role authenticated;
select throws_like(format($$ select knowledge.suspend_retrieval_configuration(%L, 'kort') $$, pg_temp.cfg('pgtap-bedrock', 2)),
  '%begrundelse%', 'en suspendering kræver en begrundelse');
select lives_ok(format($$ select knowledge.suspend_retrieval_configuration(%L, 'pgTAP: fiktiv faglig vurdering') $$, pg_temp.cfg('pgtap-bedrock', 2)),
  'administratoren suspenderer');
select throws_like(format($$ select knowledge.retire_retrieval_configuration(%L, 'pgTAP: udfases efter suspendering') $$, gen_random_uuid()),
  '%kun en kandidat%', 'kun kendte konfigurationer kan udfases');
select lives_ok(format($$ select knowledge.retire_retrieval_configuration(%L, 'pgTAP: udfases efter suspendering') $$, pg_temp.cfg('pgtap-bedrock', 2)),
  'en suspenderet konfiguration udfases');
reset role;
select is((select count(*)::int from knowledge.retrieval_configurations where label = 'pgtap-bedrock'), 2, 'udfasede konfigurationer slettes aldrig');
select is((select count(*)::int from knowledge.evaluation_runs where configuration_id in (pg_temp.cfg('pgtap-bedrock'), pg_temp.cfg('pgtap-bedrock', 2))), 4,
  'alle kørsler er bevaret og kan forklare evidensen bagefter');
select ok((select bool_and(details ? 'fingerprint') from audit.audit_log
           where action in ('knowledge.retrieval_configuration.approved', 'knowledge.retrieval_configuration.activated',
                            'knowledge.retrieval_configuration.suspended', 'knowledge.retrieval_configuration.retired')),
  'alle livscyklus-hændelser auditeres med fingeraftryk');

-- ----------------------------------------------------------------------------
-- 9. En konfiguration, hvis chunker-version ikke findes i korpusset, kan ikke aktiveres
-- ----------------------------------------------------------------------------

insert into pgtap_runs select 'c1', pg_temp.publish(pg_temp.with_material(pg_temp.base_report(),
  jsonb_set(pg_temp.base_report() #> '{configuration,declared}', '{chunkerVersions}', '["structure/9"]'), 'run-c1'));
select pg_temp.as_user('60000000-0000-4000-a000-000000000001');
set local role authenticated;
select lives_ok(format($$ select knowledge.approve_retrieval_configuration(%L, %L, '[]') $$, pg_temp.cfg('pgtap-bedrock', 3), (select id from pgtap_runs where name = 'c1')),
  'C godkendes');
select throws_like(format($$ select knowledge.activate_retrieval_configuration(%L) $$, pg_temp.cfg('pgtap-bedrock', 3)),
  '%Afvist (chunker)%structure/9%', 'chunker-versioner, der ikke findes i korpusset, blokerer aktiveringen');
reset role;

-- ----------------------------------------------------------------------------
-- 10. Pilot-politikken for statistisk usikkerhed (8B-I6.1, B-030)
-- ----------------------------------------------------------------------------

-- Det evaluerede område valideres ved registreringen (også når checksums er genberegnet).
select throws_like($$ select pg_temp.publish(pg_temp.with_run(jsonb_set(pg_temp.base_report(), '{corpus,scope}', '[]'), 'run-scope-empty')) $$,
  '%evaluerede område (produkter og dokumenttyper) er ugyldigt%', 'en kørsel uden evalueret område afvises');
select throws_like($$ select pg_temp.publish(pg_temp.with_run(jsonb_set(pg_temp.base_report(), '{corpus,scope}', '[{"product":"pgTAP Registerprodukt","documentType":"terms"}]'), 'run-scope-name-only')) $$,
  '%evaluerede område (produkter og dokumenttyper) er ugyldigt%', 'et område med produktnavnet som identitet (reportSchema 4) afvises — identiteten er produktets id (8B-I6.2)');
select throws_like($$ select pg_temp.publish(pg_temp.with_run(jsonb_set(pg_temp.base_report(), '{corpus,scope}', '[{"documentType":"terms","productId":"pgTAP Registerprodukt","productName":"pgTAP Registerprodukt"}]'), 'run-scope-id')) $$,
  '%evaluerede område (produkter og dokumenttyper) er ugyldigt%', 'et produkt-id, der ikke er et id, afvises');
select throws_like($$ select pg_temp.publish(pg_temp.with_run(jsonb_set(pg_temp.base_report(), '{corpus,scope}', '[{"documentType":"terms","productId":"62000000-0000-4000-a000-000000000001","productName":" pgTAP Registerprodukt"}]'), 'run-scope-trim')) $$,
  '%evaluerede område (produkter og dokumenttyper) er ugyldigt%', 'et produktnavn med omgivende mellemrum afvises');
select throws_like($$ select pg_temp.publish(pg_temp.with_run(jsonb_set(pg_temp.base_report(), '{corpus,scope}', '[{"documentType":"terms","productId":"62000000-0000-4000-a000-000000000001","productName":"pgTAP Registerprodukt"},{"documentType":"ukendt_type","productId":"62000000-0000-4000-a000-000000000001","productName":"pgTAP Registerprodukt"}]'), 'run-scope-type')) $$,
  '%evaluerede område (produkter og dokumenttyper) er ugyldigt%', 'en ukendt dokumenttype i området afvises');
select throws_like($$ select pg_temp.publish(pg_temp.with_run(jsonb_set(pg_temp.base_report(), '{corpus,scope}', '[{"documentType":"terms","productId":"62000000-0000-4000-a000-000000000001","productName":"pgTAP Registerprodukt"},{"documentType":"terms","productId":"62000000-0000-4000-a000-000000000001","productName":"Andet navn"}]'), 'run-scope-dup')) $$,
  '%dubletter%', 'samme produkt-id og dokumenttype to gange er en dublet, også med et andet navn');

insert into pgtap_runs select 'd1', pg_temp.publish(pg_temp.adapt(pg_temp.ts_uncertain_pilot(), 0.33, 'run-d1'));
select ok((select outcome = 'pass_with_uncertainty' and tier = 'pilot' and verdict = 'uncertain' and not passed and quality_gates_passed
                  and uncertain_gates = array['Q1', 'Q4', 'Q5']
           from knowledge.evaluation_runs where id = (select id from pgtap_runs where name = 'd1')),
  'en pilot bestået på punktestimatet med usikre intervaller får udfaldet pass_with_uncertainty, og de usikre gates gemmes');
select ok((select (metrics #> '{source_recall_at_k,interval,lower}')::numeric < 0.95 from knowledge.evaluation_runs where id = (select id from pgtap_runs where name = 'd1')),
  'Wilson-intervallerne gemmes med kørslen');
select pg_temp.as_user('60000000-0000-4000-a000-000000000001');
set local role authenticated;
select throws_like(format($$ select knowledge.approve_retrieval_configuration(%L, %L, '[]') $$, pg_temp.cfg('pgtap-bedrock', 4), (select id from pgtap_runs where name = 'd1')),
  '%ikke accepteret af et menneske%', 'usikkerheden konverteres aldrig automatisk: uden menneskelig accept kan piloten ikke godkendes');
reset role;
select is(knowledge.evaluation_run_approvable((select id from pgtap_runs where name = 'd1')), false, 'en usikker pilot-kørsel uden accept kan ikke bære en godkendelse');
select throws_like(format($$ select set_config('knowledge.registry_write', 'on', true);
                           update knowledge.retrieval_configurations set status = 'approved', approval_run_id = %L, gate_set_id = %L, tier = 'pilot',
                                  approved_at = now(), approved_by = (select id from identity.users where auth_id = '60000000-0000-4000-a000-000000000001')
                           where id = %L $$,
                          (select id from pgtap_runs where name = 'd1'), (select id from pgtap_gate), pg_temp.cfg('pgtap-bedrock', 4)),
  '%kræver en bestået (eller, for pilot, accepteret)%', 'heller ikke en direkte skrivning kan godkende en uaccepteret usikker kørsel');
select pg_temp.as_user('60000000-0000-4000-a000-000000000002');
set local role authenticated;
select throws_ok(format($$ select knowledge.accept_evaluation_uncertainty(%L, 'pgTAP: rådgiverens forsøg på at acceptere') $$, (select id from pgtap_runs where name = 'd1')),
  '42501', null, 'en rådgiver kan ikke acceptere usikkerheden');
reset role;
select pg_temp.as_user('60000000-0000-4000-a000-000000000001');
set local role authenticated;
select throws_like(format($$ select knowledge.accept_evaluation_uncertainty(%L, 'kort') $$, (select id from pgtap_runs where name = 'd1')),
  '%begrundelse%', 'accepten kræver en skriftlig begrundelse');
select throws_like(format($$ select knowledge.accept_evaluation_uncertainty(%L, 'pgTAP: forsøg på at acceptere en bestået kørsel') $$, (select id from pgtap_runs where name = 'a1')),
  '%Afvist (not_uncertain)%', 'kun en usikker pilot-kørsel kan accepteres');
select lives_ok(format($$ select knowledge.accept_evaluation_uncertainty(%L, 'pgTAP: fiktiv accept af usikkerheden i en begrænset pilot') $$, (select id from pgtap_runs where name = 'd1')),
  'en administrator med system.settings.manage accepterer usikkerheden');
select throws_like(format($$ select knowledge.accept_evaluation_uncertainty(%L, 'pgTAP: accepteret for anden gang') $$, (select id from pgtap_runs where name = 'd1')),
  '%Afvist (already_accepted)%', 'en kørsel accepteres kun én gang');
select throws_ok($$ update knowledge.evaluation_uncertainty_acceptances set justification = 'ændret efterfølgende af administrator' $$, '42501', null,
  'administratoren kan ikke rette en accept');
reset role;
select ok((select accepted_by = (select id from identity.users where auth_id = '60000000-0000-4000-a000-000000000001')
                  and accepted_at is not null and tier = 'pilot'
                  and scope = '[{"documentType":"terms","productId":"62000000-0000-4000-a000-000000000001","productName":"pgTAP Registerprodukt"}]'::jsonb
                  and (select array_agg(g ->> 'id' order by g ->> 'id') from jsonb_array_elements(uncertain_gates) g) = array['Q1', 'Q4', 'Q5']
                  and (uncertain_gates -> 0 -> 'interval' ->> 'lower') is not null
                  and configuration_id = pg_temp.cfg('pgtap-bedrock', 4)
           from knowledge.evaluation_uncertainty_acceptances where run_id = (select id from pgtap_runs where name = 'd1')),
  'accepten registrerer hvem, hvornår, kørsel, konfiguration, område, de usikre gates og deres intervaller');
update knowledge.products set name = 'pgTAP Registerprodukt efter accept' where id = '62000000-0000-4000-a000-000000000001';
select is((select scope from knowledge.evaluation_uncertainty_acceptances where run_id = (select id from pgtap_runs where name = 'd1')),
  '[{"documentType":"terms","productId":"62000000-0000-4000-a000-000000000001","productName":"pgTAP Registerprodukt"}]'::jsonb,
  'accepten bevarer produktets id og navnet på evalueringstidspunktet efter en omdøbning');
update knowledge.products set name = 'pgTAP Registerprodukt' where id = '62000000-0000-4000-a000-000000000001';
select throws_like($$ select set_config('knowledge.registry_write', 'on', true); delete from knowledge.evaluation_uncertainty_acceptances $$,
  '%kan ikke ændres eller slettes%', 'en accept er append-only — heller ikke ejeren kan slette den');
select ok(knowledge.evaluation_run_approvable((select id from pgtap_runs where name = 'd1'))
          and knowledge.evaluation_run_approvable((select id from pgtap_runs where name = 'a1'))
          and not knowledge.evaluation_run_approvable((select id from pgtap_runs where name = 'b2')),
  'efter accepten kan kørslen bære en godkendelse; en bestået kan altid, et hårdt brud aldrig');
select ok(exists (select 1 from audit.audit_log where action = 'knowledge.evaluation_run.uncertainty_accepted'
                  and entity_id = (select id from pgtap_runs where name = 'd1')::text and details ? 'uncertain_gates'), 'accepten auditeres');
select pg_temp.as_user('60000000-0000-4000-a000-000000000001');
set local role authenticated;
select lives_ok(format($$ select knowledge.approve_retrieval_configuration(%L, %L, '[]') $$, pg_temp.cfg('pgtap-bedrock', 4), (select id from pgtap_runs where name = 'd1')),
  'med accepten kan pilot-konfigurationen godkendes');
select lives_ok(format($$ select knowledge.activate_retrieval_configuration(%L) $$, pg_temp.cfg('pgtap-bedrock', 4)), 'og aktiveres');
select ok((knowledge.retrieval_context() #> '{configuration,evaluation}') @> '{"outcome":"pass_with_uncertainty","approved":true,"uncertaintyAccepted":true}'::jsonb
          and (knowledge.retrieval_context() #>> '{configuration,productionReady}') = 'true',
  'konteksten viser den accepterede usikkerhed');
reset role;
-- Forsvar i dybden: skulle accepten mangle (her fjernet af tabelejeren uden om triggerne), er
-- konfigurationen ikke længere klar — konteksten genberegner det ved hvert kald.
alter table knowledge.evaluation_uncertainty_acceptances disable trigger user;
delete from knowledge.evaluation_uncertainty_acceptances where run_id = (select id from pgtap_runs where name = 'd1');
alter table knowledge.evaluation_uncertainty_acceptances enable trigger user;
select pg_temp.as_user('60000000-0000-4000-a000-000000000002');
set local role authenticated;
select ok((knowledge.retrieval_context() #>> '{configuration,productionReady}') = 'false'
          and (knowledge.retrieval_context() #> '{configuration,notReady}') ? 'evaluation'
          and (knowledge.retrieval_context() #>> '{configuration,evaluation,approved}') = 'false',
  'uden accept er pilot-konfigurationen ikke klar til produktion');
reset role;

-- Tier standard: kvalitetskravet er uændret — en usikker kørsel kan aldrig godkendes eller accepteres.
insert into pgtap_runs select 'e1', pg_temp.publish(pg_temp.adapt(pg_temp.ts_uncertain_standard(), 0.34, 'run-e1'));
select is((select outcome from knowledge.evaluation_runs where id = (select id from pgtap_runs where name = 'e1')), 'insufficient_certainty',
  'en usikker standard-kørsel (100 spørgsmål) har udfaldet insufficient_certainty');
select pg_temp.as_user('60000000-0000-4000-a000-000000000001');
set local role authenticated;
select throws_like(format($$ select knowledge.approve_retrieval_configuration(%L, %L, '[]') $$, pg_temp.cfg('pgtap-bedrock', 5), (select id from pgtap_runs where name = 'e1')),
  '%statistisk sikre%', 'en usikker standard-kørsel kan ikke godkendes');
select throws_like(format($$ select knowledge.accept_evaluation_uncertainty(%L, 'pgTAP: forsøg på at acceptere standard-usikkerhed') $$, (select id from pgtap_runs where name = 'e1')),
  '%Afvist (not_uncertain)%', 'usikkerhed i tier standard kan ikke accepteres manuelt');
reset role;

-- Et hårdt gate-brud kan aldrig accepteres.
select throws_like(format($$ select knowledge.accept_evaluation_uncertainty(%L, 'pgTAP: forsøg på at acceptere et hårdt brud') $$, (select id from pgtap_runs where name = 'b2')),
  '%Afvist (not_uncertain)%', 'en kørsel med et hårdt gate-brud kan aldrig accepteres manuelt');

-- ----------------------------------------------------------------------------
-- 11. 8B-I7: regressionshændelser og performance-målinger
-- ----------------------------------------------------------------------------

-- Den hårde regression i afsnit 8 (b2) blev auditeret med sæt, gate-sæt og fingeraftryk.
select ok((select a.details ->> 'result' = 'hard_gate_regression'
                  and a.details -> 'failed_hard_gates' = '["H1"]'::jsonb
                  and a.details -> 'eval_set' = jsonb_build_object('id', r.eval_set_id, 'version', r.eval_set_version, 'checksum', r.eval_set_checksum)
                  and a.details -> 'gate_set' = jsonb_build_object('id', 'pgtap-gates', 'version', 1, 'checksum', r.gate_set_checksum)
                  and a.details ->> 'runtime_fingerprint' = r.runtime_fingerprint
           from audit.audit_log a join knowledge.evaluation_runs r on r.id::text = a.entity_id
           where a.action = 'knowledge.evaluation_run.regression' and r.id = (select id from pgtap_runs where name = 'b2')),
  'en hård regression auditeres med evalueringssæt, gate-sæt, runtime-fingeraftryk og de brudte gates');
select is((select count(*)::int from audit.audit_log where action = 'knowledge.evaluation_run.regression'
           and entity_id in (select id::text from pgtap_runs where name in ('a1', 'b1', 'b3', 'e1'))), 0,
  'kun en kørsel af konfigurationen i drift er en regression — ikke en kandidats eller en suspenderets');

-- En kvalitetsregression af den aktive pilot-konfiguration (v4, fra afsnit 10).
insert into pgtap_runs select 'q1', pg_temp.publish(pg_temp.adapt(pg_temp.ts_quality_regression(), 0.33, 'run-q1'));
select is((select status from knowledge.retrieval_configurations where id = pg_temp.cfg('pgtap-bedrock', 4)), 'active',
  'en kvalitetsregression suspenderer ikke — den går til vurdering');
select ok((select a.details ->> 'result' = 'quality_regression'
                  and a.details -> 'failed_quality_gates' = '["Q1", "Q2", "Q3"]'::jsonb
                  and a.details -> 'failed_hard_gates' = '[]'::jsonb
                  and a.details ->> 'runtime_fingerprint' = r.runtime_fingerprint
                  and a.details -> 'eval_set' ->> 'checksum' = r.eval_set_checksum
           from audit.audit_log a join knowledge.evaluation_runs r on r.id::text = a.entity_id
           where a.action = 'knowledge.evaluation_run.regression' and r.id = (select id from pgtap_runs where name = 'q1')),
  'kvalitetsregressionen auditeres med de fejlede kvalitetsgates, sættet og fingeraftrykket');
select ok((ops.system_health() -> 'evaluation') @> '{"runId": "run-q1", "regression": true, "hardGatesPassed": true, "qualityGatesPassed": false}'::jsonb,
  'systemstatus viser regressionen for konfigurationen i drift (grundlaget for alarmen)');

-- Performance: TypeScript og SQL regner ens (literalen er genereret af evals/engine/performance.ts).
select is(knowledge.performance_results(pg_temp.ts_performance()), pg_temp.ts_performance() -> 'results',
  'percentiler og resultater genberegnes identisk i SQL');
select is(knowledge.checksum_of(pg_temp.ts_performance() - 'checksum'), pg_temp.ts_performance() ->> 'checksum',
  'målingens checksum genberegnes identisk i SQL');

create function pg_temp.measurement(p jsonb, p_run text, p_fp text) returns jsonb language plpgsql as $f$
declare v jsonb := jsonb_set(jsonb_set(jsonb_set(p, '{runId}', to_jsonb(p_run)), '{configurationFingerprint}', to_jsonb(p_fp)), '{measurementId}', to_jsonb(gen_random_uuid()::text));
begin
  v := jsonb_set(v, '{results}', knowledge.performance_results(v));
  return jsonb_set(v, '{checksum}', to_jsonb(knowledge.checksum_of(v - 'checksum')));
end $f$;
create function pg_temp.reseal_measurement(v jsonb) returns jsonb language sql as $f$
  select jsonb_set(v, '{checksum}', to_jsonb(knowledge.checksum_of(v - 'checksum')))
$f$;
create function pg_temp.record_measurement(m jsonb) returns uuid language plpgsql as $f$
declare v uuid;
begin
  set local role evaluation_publisher_login;
  v := knowledge.record_performance_measurement(m);
  reset role;
  return v;
end $f$;
create temp table pgtap_m as
  select pg_temp.measurement(pg_temp.ts_performance(), 'run-q1', (select runtime_fingerprint from knowledge.evaluation_runs where run_id = 'run-q1')) as m;
grant select on pgtap_m to public;

select throws_like($$ select pg_temp.record_measurement(jsonb_set((select m from pgtap_m), '{retrieval,total,0}', '1')) $$,
  '%Afvist (checksum)%', 'en måling, der er ændret efter checksummen, afvises');
select throws_like($$ select pg_temp.record_measurement(pg_temp.reseal_measurement(jsonb_set((select m from pgtap_m), '{results,1,status}', '"met"'))) $$,
  '%Afvist (recompute)%', 'et resultat, der ikke stemmer med målingerne, afvises — også med ny checksum');
select throws_like($$ select pg_temp.record_measurement(pg_temp.reseal_measurement(jsonb_set((select m from pgtap_m), '{runId}', '"run-ukendt"'))) $$,
  '%Afvist (run)%', 'en måling uden registreret evalueringskørsel afvises');
select throws_like($$ select pg_temp.record_measurement(pg_temp.reseal_measurement(jsonb_set((select m from pgtap_m), '{configurationFingerprint}', to_jsonb(repeat('e', 64))))) $$,
  '%Afvist (run)%', 'en måling med et andet fingeraftryk end kørslens afvises');
select throws_like($$ select pg_temp.record_measurement(pg_temp.reseal_measurement(jsonb_set((select m from pgtap_m), '{environment}', '"fixture"'))) $$,
  '%Afvist (environment)%', 'kun målinger fra evalueringsmiljøet registreres');
select throws_like($$ select pg_temp.record_measurement(pg_temp.reseal_measurement(jsonb_set((select m from pgtap_m), '{targets}', '"performance-targets-v0"'))) $$,
  '%Afvist (targets)%', 'en ukendt version af målene afvises');
select throws_like($$ select pg_temp.record_measurement(pg_temp.reseal_measurement(jsonb_set((select m from pgtap_m), '{retrieval,search,0}', '-1'))) $$,
  '%Afvist (format)%', 'negative målinger afvises');
select pg_temp.as_user('60000000-0000-4000-a000-000000000001');
set local role authenticated;
select throws_ok($$ select knowledge.record_performance_measurement((select m from pgtap_m)) $$, '42501', null, 'en administrator kan ikke registrere en måling');
reset role;
select lives_ok($$ select pg_temp.record_measurement((select m from pgtap_m)) $$, 'evaluation_publisher registrerer målingen');
select ok((select configuration_id = pg_temp.cfg('pgtap-bedrock', 4)
                  and evaluation_run_id = (select id from pgtap_runs where name = 'q1')
                  and deviations = array['retrieval_total_p95', 'query_embedding_p95', 'rerank_p95', 'ingestion_corpus_2000_pages_seconds']
           from knowledge.performance_measurements where checksum = (select m ->> 'checksum' from pgtap_m)),
  'målingen hører til kørslen og konfigurationen; ikke-nåede og ikke-målte mål er afvigelser');
select is(pg_temp.record_measurement((select m from pgtap_m)), (select id from knowledge.performance_measurements where checksum = (select m ->> 'checksum' from pgtap_m)),
  'samme måling igen giver den registrerede — idempotent, ingen ny række (8B-I8 C4)');
select throws_like($$ select pg_temp.record_measurement(pg_temp.reseal_measurement(jsonb_set((select m from pgtap_m), '{measuredAt}', '"2026-10-08T09:00:00.000Z"'))) $$,
  '%duplicate key%', 'en anden måling med samme måling-id registreres ikke');
select throws_like($$ select set_config('knowledge.registry_write', 'on', true); update knowledge.performance_measurements set deviations = '{}' $$,
  '%kan ikke ændres eller slettes%', 'en måling er append-only');
select ok(exists (select 1 from audit.audit_log where action = 'knowledge.performance_measurement.recorded' and details ->> 'run_id' = 'run-q1'), 'registreringen auditeres');

-- Godkendelse af afvigelser (§17 pkt. 10).
select pg_temp.as_user('60000000-0000-4000-a000-000000000002');
set local role authenticated;
select throws_ok($$ select knowledge.accept_performance_deviation((select id from knowledge.performance_measurements order by registered_at desc limit 1), 'pgTAP: rådgiverens forsøg på godkendelse') $$,
  '42501', null, 'en rådgiver kan ikke godkende en afvigelse');
reset role;
create temp table pgtap_pm as select id from knowledge.performance_measurements where checksum = (select m ->> 'checksum' from pgtap_m);
grant select on pgtap_pm to public;
select pg_temp.as_user('60000000-0000-4000-a000-000000000001');
set local role authenticated;
select throws_like($$ select knowledge.accept_performance_deviation((select id from pgtap_pm), 'kort') $$, '%begrundelse%', 'en godkendelse kræver en begrundelse');
select lives_ok($$ select knowledge.accept_performance_deviation((select id from pgtap_pm), 'pgTAP: fiktiv godkendelse, gentages i drift med rigtige udbydere') $$,
  'en administrator godkender afvigelsen dokumenteret');
select throws_like($$ select knowledge.accept_performance_deviation((select id from pgtap_pm), 'pgTAP: godkendt for anden gang her') $$,
  '%Afvist (already_accepted)%', 'en afvigelse godkendes kun én gang');
reset role;
select ok((select accepted_by = (select id from identity.users where auth_id = '60000000-0000-4000-a000-000000000001')
                  and (select array_agg(d ->> 'target' order by d ->> 'target') from jsonb_array_elements(deviations) d)
                      = array['ingestion_corpus_2000_pages_seconds', 'query_embedding_p95', 'rerank_p95', 'retrieval_total_p95']
           from knowledge.performance_deviation_acceptances where measurement_id = (select id from pgtap_pm)),
  'godkendelsen registrerer hvem og præcis hvilke afvigelser (med værdier og grænser)');
select ok((ops.system_health() -> 'performance') @> '{"accepted": true}'::jsonb, 'systemstatus viser, at afvigelsen er godkendt');
-- En måling uden afvigelser kan ikke "godkendes".
create temp table pgtap_pm_ok as select pg_temp.record_measurement(pg_temp.measurement(
  '{"schema":1,"kind":"retrieval-performance","measurementId":"x","runId":"x","measuredAt":"2026-10-08T08:00:00.000Z","environment":"evaluation","configurationFingerprint":"x","targets":"performance-targets-v1","retrieval":{"total":[100],"queryEmbedding":[50],"search":[40],"rerank":[90]},"ingestion":{"documents":[{"pages":60,"seconds":120}],"corpusPages":2100,"corpusSeconds":3600},"results":[],"checksum":"x"}'::jsonb,
  'run-q1', (select runtime_fingerprint from knowledge.evaluation_runs where run_id = 'run-q1'))) as id;
grant select on pgtap_pm_ok to public;
select pg_temp.as_user('60000000-0000-4000-a000-000000000001');
set local role authenticated;
select throws_like($$ select knowledge.accept_performance_deviation((select id from pgtap_pm_ok), 'pgTAP: forsøg uden afvigelse her') $$,
  '%Afvist (no_deviation)%', 'en måling, der når alle mål, har intet at godkende');
reset role;

-- ----------------------------------------------------------------------------
-- 12. 8B-I7.1: databasen klassificerer kørslen; CI-jobbets ønskede tilstand er kun diagnostik
-- ----------------------------------------------------------------------------

create function pg_temp.publish_as(r jsonb, p_mode text) returns jsonb language plpgsql as $f$
declare v jsonb;
begin
  set local role evaluation_publisher_login;
  v := knowledge.publish_evaluation_run(r, p_mode);
  reset role;
  return v;
end $f$;
-- Kalderen kan selv sætte den GUC, publiceringsfunktionen bruger. Det må intet afgøre.
create function pg_temp.publish_with_guc(r jsonb, p_guc text) returns uuid language plpgsql as $f$
declare v uuid;
begin
  set local role evaluation_publisher_login;
  perform set_config('knowledge.requested_mode', p_guc, true);
  v := knowledge.record_evaluation_run(r);
  perform set_config('knowledge.requested_mode', '', true);
  reset role;
  return v;
end $f$;
create temp table pgtap_events (name text primary key, e jsonb);
grant select on pgtap_events to public;

select is((select knowledge.evaluation_run_classification(r) from knowledge.evaluation_runs r where r.run_id = 'run-q1'), 'quality_regression',
  'kvalitetsregressionen fra afsnit 11 klassificeres af databasen, også uden en ønsket tilstand');
select is((select array_agg(knowledge.evaluation_run_classification(r) order by p.name) from pgtap_runs p join knowledge.evaluation_runs r on r.id = p.id
           where p.name in ('a1', 'b2')), array['baseline', 'hard_gate_regression'],
  'kandidatens kørsel er en baseline; den hårde regression fra afsnit 8 er en hård regression');

-- CI siger baseline — databasen konstaterer en kvalitetsregression af konfigurationen i drift.
insert into pgtap_events select 'q2', pg_temp.publish_as(pg_temp.adapt(pg_temp.ts_quality_regression(), 0.33, 'run-q2'), 'baseline');
select ok((select e @> '{"classification": "quality_regression", "requestedMode": "baseline", "registeredWhile": "active", "configurationStatus": "active", "suspended": false}'::jsonb
                  and e -> 'failedQualityGates' = '["Q1", "Q2", "Q3"]'::jsonb and e -> 'failedHardGates' = '[]'::jsonb
           from pgtap_events where name = 'q2'),
  'CI siger baseline, databasen konstaterer en kvalitetsregression: klassifikationen er databasens');
select ok((select details ->> 'classification' = 'quality_regression' and details ->> 'requested_mode' = 'baseline' from audit.audit_log
           where action = 'knowledge.evaluation_run.regression' and entity_id = (select e ->> 'id' from pgtap_events where name = 'q2')),
  'regressionen auditeres med den ønskede tilstand ved siden af, så uoverensstemmelsen kan ses');
select is((select status from knowledge.retrieval_configurations where id = pg_temp.cfg('pgtap-bedrock', 4)), 'active',
  'en kvalitetsregression suspenderer ikke, uanset den ønskede tilstand');
insert into pgtap_events select 'q3', pg_temp.publish_as(pg_temp.adapt(pg_temp.ts_quality_regression(), 0.33, 'run-q3'), 'regression');
select ok((select e @> '{"classification": "quality_regression", "requestedMode": "regression", "suspended": false}'::jsonb from pgtap_events where name = 'q3'),
  'samme kvalitetsregression, når CI siger regression');

-- En bestået kørsel af konfigurationen i drift er en (bestået) regression, ikke en baseline.
insert into pgtap_events select 'p1', pg_temp.publish_as(pg_temp.adapt(pg_temp.ts_uncertain_pilot(), 0.33, 'run-p1'), 'baseline');
select ok((select e @> '{"classification": "regression", "requestedMode": "baseline", "outcome": "pass_with_uncertainty", "configurationStatus": "active"}'::jsonb
           from pgtap_events where name = 'p1'),
  'en bestået kørsel af konfigurationen i drift er en regression, også når CI siger baseline');

-- CI siger regression — databasen konstaterer en baseline (en ny kandidat).
insert into pgtap_events select 'c1', pg_temp.publish_as(pg_temp.adapt(pg_temp.ts_report(), 0.44, 'run-k1'), 'regression');
select ok((select e @> '{"classification": "baseline", "requestedMode": "regression", "registeredWhile": "candidate", "configurationStatus": "candidate", "suspended": false}'::jsonb
           from pgtap_events where name = 'c1'),
  'CI siger regression, databasen konstaterer en baseline: ingen falsk regression');
select is((select count(*)::int from audit.audit_log where action = 'knowledge.evaluation_run.regression'
           and entity_id = (select e ->> 'id' from pgtap_events where name = 'c1')), 0, 'og der auditeres ingen regression');

-- En ugyldig kørsel registreres aldrig — den kan hverken blive baseline eller bestået.
select throws_like($$ select pg_temp.publish_as(pg_temp.reseal(jsonb_set(pg_temp.adapt(pg_temp.ts_report(), 0.55, 'run-i1'), '{configuration,environment}', '"fixture"')), 'baseline') $$,
  '%Afvist (invalid_run)%', 'en ugyldig kørsel (H7) afvises, også når CI siger baseline');
select throws_like($$ select pg_temp.publish_as(pg_temp.with_h6_breach(pg_temp.adapt(pg_temp.ts_report(), 0.55, 'run-i2')), 'regression') $$,
  '%Afvist (invalid_run)%H6%', 'H6 for en konfiguration uden for drift afvises, også når CI siger regression');
select is((select count(*)::int from knowledge.evaluation_runs where run_id in ('run-i1', 'run-i2')), 0,
  'en ugyldig kørsel efterlader intet, der kan ligne en baseline eller en bestået kørsel');

-- Den ønskede tilstand valideres, og kun publisheren kan publicere.
select throws_like($$ select pg_temp.publish_as(pg_temp.adapt(pg_temp.ts_report(), 0.44, 'run-m1'), 'production') $$,
  '%Afvist (requested_mode)%', 'en ukendt ønsket tilstand afvises');
select pg_temp.as_user('60000000-0000-4000-a000-000000000001');
set local role authenticated;
select throws_ok($$ select knowledge.publish_evaluation_run('{}'::jsonb, 'baseline') $$, '42501', null, 'en administrator kan ikke publicere');
reset role;
select throws_ok($$ select knowledge.publish_evaluation_run('{}'::jsonb, 'baseline') $$, '42501', null, 'heller ikke ejeren uden publisherens identitet');
select throws_ok($$ select knowledge.publish_evaluation_run('{}'::jsonb, 'production') $$, '42501', null,
  'publisherens identitet kontrolleres, før noget andet læses');

insert into pgtap_runs select 'g1', pg_temp.publish_with_guc(pg_temp.adapt(pg_temp.ts_report(), 0.66, 'run-g1'), 'hard_gate_regression');
select ok((select r.requested_mode is null and r.registered_while = 'candidate' and knowledge.evaluation_run_classification(r) = 'baseline'
           from knowledge.evaluation_runs r where r.id = (select id from pgtap_runs where name = 'g1')),
  'en værdi sat af kalderen er hverken en ønsket tilstand eller en klassifikation');

-- CI siger baseline — databasen konstaterer en hård regression: suspendering og kritisk klasse.
insert into pgtap_events select 'h1', pg_temp.publish_as(pg_temp.with_h1_breach(pg_temp.adapt(pg_temp.ts_report(), 0.33, 'run-h1x'), 'run-h1'), 'baseline');
select ok((select e @> '{"classification": "hard_gate_regression", "requestedMode": "baseline", "registeredWhile": "active", "configurationStatus": "suspended", "suspended": true}'::jsonb
                  and e -> 'failedHardGates' = '["H1"]'::jsonb
           from pgtap_events where name = 'h1'),
  'en hård regression suspenderer og klassificeres som hård, også når CI siger baseline');
select is((select count(*)::int from knowledge.retrieval_configurations where status = 'active'), 0, 'ingen fallback efter suspenderingen');
select ok(knowledge.evaluation_run_event((select (e ->> 'id')::uuid from pgtap_events where name = 'q2')) @> '{"configurationStatus": "suspended", "suspended": false}'::jsonb,
  'kun den kørsel, der suspenderede, står som årsag — ikke en tidligere kørsel af samme konfiguration');
select ok((ops.system_health() -> 'evaluation') @> '{"classification": "hard_gate_regression", "regression": true, "requestedMode": "baseline"}'::jsonb
          and ops.system_health() #>> '{configuration,status}' = 'suspended',
  'systemstatus viser databasens klassifikation og den suspenderede konfiguration');

-- ----------------------------------------------------------------------------
-- 13. 8B-I8 C4: H6 i regression suspenderer sikkert; publiceringen er idempotent
-- ----------------------------------------------------------------------------

-- Konfiguration C (minScore 0.77) kommer i drift.
insert into pgtap_events select 'k6', pg_temp.publish_as(pg_temp.adapt(pg_temp.ts_report(), 0.77, 'run-k6'), 'baseline');
create temp table pgtap_c as select (e ->> 'configurationId')::uuid as cfg, (e ->> 'id')::uuid as run from pgtap_events where name = 'k6';
grant select on pgtap_c to public;
select pg_temp.as_user('60000000-0000-4000-a000-000000000001');
set local role authenticated;
select lives_ok($$ select knowledge.approve_retrieval_configuration((select cfg from pgtap_c), (select run from pgtap_c), '[]') $$, 'C godkendes på sin beståede kørsel');
select lives_ok($$ select knowledge.activate_retrieval_configuration((select cfg from pgtap_c)) $$, 'C aktiveres');
reset role;

-- Et forfalsket H6-brud: runtime ER den erklærede konfiguration.
create function pg_temp.with_forged_h6(r jsonb) returns jsonb language sql as $f$
  select pg_temp.reseal(
    jsonb_set(jsonb_set(jsonb_set(jsonb_set(r,
      '{failures}', '[{"caseId":null,"gate":"H6","explanation":"pgTAP: påstået afvigelse","rootCauseNote":null}]'),
      '{hardGates,5}', '{"id":"H6","status":"fail","violations":1}'),
      '{valid}', 'false'),
      '{verdict}', '"fail"'))
$f$;
-- En skjult afvigelse: runtime er en anden, men rapporten viser intet H6-brud.
create function pg_temp.with_hidden_h6(r jsonb) returns jsonb language sql as $f$
  select pg_temp.reseal(
    jsonb_set(jsonb_set(jsonb_set(r,
      '{configuration,runtime}', jsonb_set(r #> '{configuration,declared}', '{params,topK}', '3')),
      '{configuration,runtimeFingerprint}', to_jsonb(knowledge.retrieval_fingerprint(jsonb_set(r #> '{configuration,declared}', '{params,topK}', '3')))),
      '{configuration,matches}', 'false'))
$f$;

select throws_like($$ select pg_temp.publish_as(pg_temp.with_forged_h6(pg_temp.adapt(pg_temp.ts_report(), 0.77, 'run-f6')), 'regression') $$,
  '%Afvist (h6_evidence)%påstår%', 'et forfalsket H6-brud (fingeraftrykkene matcher) afvises');
select throws_like($$ select pg_temp.publish_as(pg_temp.with_hidden_h6(pg_temp.adapt(pg_temp.ts_report(), 0.77, 'run-s6')), 'regression') $$,
  '%Afvist (h6_evidence)%netop ét H6-brud%', 'en afvigelse uden H6-brud afvises — den kan ikke registreres som bestået');
select throws_like($$ select pg_temp.publish_as(jsonb_set(pg_temp.with_h6_breach(pg_temp.adapt(pg_temp.ts_report(), 0.77, 'run-x6')), '{metrics,mrr_at_k,value}', '0.01'), 'regression') $$,
  '%Afvist (report_checksum)%', 'en ændret rapport (checksum) afvises');
select throws_like($$ select pg_temp.publish_as(pg_temp.with_h6_breach(pg_temp.adapt(pg_temp.ts_report(), 0.88, 'run-b6')), 'regression') $$,
  '%Afvist (invalid_run)%H6%', 'H6 i en rapport om B (ikke i drift) afvises som ugyldig');
select throws_like($$ select pg_temp.publish_as(pg_temp.reseal(jsonb_set(pg_temp.adapt(pg_temp.ts_report(), 0.77, 'run-e7'), '{configuration,environment}', '"fixture"')), 'regression') $$,
  '%Afvist (invalid_run)%H7%', 'H7 for konfigurationen i drift er ugyldig og suspenderer ikke');
select ok((select status = 'active' from knowledge.retrieval_configurations where id = (select cfg from pgtap_c))
          and (select count(*) = 0 from knowledge.evaluation_runs where run_id in ('run-f6', 'run-s6', 'run-x6', 'run-b6', 'run-e7')),
  'ingen af dem efterlader en kørsel, og C er fortsat i drift');

-- Det rigtige H6-brud i drift: registreres og suspenderer C i samme transaktion.
create temp table pgtap_h6 as select pg_temp.with_h6_breach(pg_temp.adapt(pg_temp.ts_report(), 0.77, 'run-h6')) as r;
grant select on pgtap_h6 to public;
insert into pgtap_events select 'h6', pg_temp.publish_as((select r from pgtap_h6), 'regression');
select ok((select e @> '{"classification": "hard_gate_regression", "registeredWhile": "active", "configurationStatus": "suspended", "suspended": true, "replayed": false}'::jsonb
                  and e -> 'failedHardGates' = '["H6"]'::jsonb
                  and (e ->> 'configurationId')::uuid = (select cfg from pgtap_c)
           from pgtap_events where name = 'h6'),
  'H6 for konfigurationen i drift er en hård regression, og netop den konfiguration suspenderes');
select ok((select status = 'suspended' and suspension_reason = 'hard_gate_failed' and suspension_run_id = (select (e ->> 'id')::uuid from pgtap_events where name = 'h6')
           from knowledge.retrieval_configurations where id = (select cfg from pgtap_c)),
  'suspenderingen peger på H6-kørslen');
select pg_temp.as_user('60000000-0000-4000-a000-000000000002');
set local role authenticated;
select is(knowledge.retrieval_context() #>> '{configuration,productionReady}', 'false', 'efter suspenderingen kan der ikke udstedes production-evidens (P3)');
reset role;

-- Idempotent: samme rapport igen ændrer intet.
insert into pgtap_events select 'h6r', pg_temp.publish_as((select r from pgtap_h6), 'regression');
select ok((select (r.e ->> 'id') = (o.e ->> 'id') and r.e @> '{"replayed": true, "classification": "hard_gate_regression"}'::jsonb
           from pgtap_events r, pgtap_events o where r.name = 'h6r' and o.name = 'h6'),
  'samme rapport igen giver den registrerede kørsels hændelse (replayed)');
select ok((select count(*) = 1 from knowledge.evaluation_runs where run_id = 'run-h6')
          and (select count(*) = 1 from audit.audit_log where action = 'knowledge.evaluation_run.published' and entity_id = (select e ->> 'id' from pgtap_events where name = 'h6'))
          and (select count(*) = 1 from knowledge.retrieval_configuration_transitions where configuration_id = (select cfg from pgtap_c) and to_status = 'suspended'),
  'ingen ny kørsel, audit eller suspendering ved gentagelsen');
select throws_like($$ select pg_temp.publish_as(pg_temp.adapt(pg_temp.ts_report(), 0.77, 'run-h6'), 'regression') $$,
  '%Afvist (duplicate)%', 'en anden rapport med samme kørsels-id er ikke en gentagelse');
select throws_like($$ select pg_temp.publish_as(jsonb_set((select r from pgtap_h6), '{metrics,mrr_at_k,value}', '0.01'), 'regression') $$,
  '%Afvist (report_checksum)%', 'en ændret rapport med den registreredes checksum er ikke en gentagelse — den efterprøves og afvises');

-- Performance: H6-kørslens tider måler ikke konfigurationen; samme måling igen er idempotent.
select throws_like($$ select pg_temp.record_measurement(pg_temp.measurement(pg_temp.ts_performance(), 'run-h6', (select runtime_fingerprint from knowledge.evaluation_runs where run_id = 'run-h6'))) $$,
  '%Afvist (run)%H6%', 'en måling fra en H6-kørsel registreres ikke');
create temp table pgtap_m6 as select pg_temp.measurement(pg_temp.ts_performance(), 'run-k6', (select runtime_fingerprint from knowledge.evaluation_runs where run_id = 'run-k6')) as m;
grant select on pgtap_m6 to public;
create temp table pgtap_m6_ids as select pg_temp.record_measurement((select m from pgtap_m6)) as id union all select pg_temp.record_measurement((select m from pgtap_m6));
select ok((select count(distinct id) = 1 and count(*) = 2 from pgtap_m6_ids)
          and (select count(*) = 1 from knowledge.performance_measurements where measurement_id = (select m ->> 'measurementId' from pgtap_m6)),
  'samme måling to gange giver én registrering');

-- ----------------------------------------------------------------------------
-- 14. B-035 (beta, L1): retrieval-metoden product_documents uden embedding og reranker
-- ----------------------------------------------------------------------------

create function pg_temp.doc_material(p_max int) returns jsonb language sql as $f$
  select jsonb_build_object('method', 'product_documents', 'embedding', null, 'reranker', null,
    'algorithmVersion', 'product-documents-1', 'params', jsonb_build_object('maxChars', p_max), 'chunkerVersions', jsonb_build_array('structure/1'))
$f$;
-- B-036: dokumentgate-sættet (D1–D6) med testens eget id, og den GENEREREDE product_documents-
-- rapport (buildDocumentReport) tilpasset testens identiteter: gate-sæt, label, område og materiale.
create function pg_temp.doc_gates() returns jsonb language sql stable as $f$
  select jsonb_set(pg_temp.ts_doc_gates(), '{id}', '"pgtap-doc-gates"')
$f$;
create function pg_temp.doc_report_from(r jsonb, p_max int, p_run text) returns jsonb language sql stable as $f$
  select pg_temp.with_material(
    jsonb_set(jsonb_set(jsonb_set(r, '{configuration,label}', '"pgtap-documents"'),
      '{gateSet}', (r -> 'gateSet') || jsonb_build_object('id', 'pgtap-doc-gates', 'checksum', knowledge.checksum_of(pg_temp.doc_gates()))),
      '{corpus,scope}', '[{"documentType":"terms","productId":"62000000-0000-4000-a000-000000000001","productName":"pgTAP Registerprodukt"}]'),
    pg_temp.doc_material(p_max), p_run)
$f$;
create function pg_temp.doc_report(p_max int, p_run text) returns jsonb language sql stable as $f$
  select pg_temp.doc_report_from(pg_temp.ts_doc_report(), p_max, p_run)
$f$;

-- Den hybride modelkontrol er uændret (B-035 tilpasser den kun for product_documents): C (hybrid,
-- i drift som suspenderet) melder 'model', når en anden embedding-model er aktiv.
create temp table pgtap_active_model as select id from knowledge.embedding_models where status = 'active';
grant select on pgtap_active_model to public;
update knowledge.embedding_models set status = 'retired', retired_at = now() where status = 'active';
update knowledge.embedding_models set status = 'active', activated_at = now(), retired_at = null where id = '61000000-0000-4000-a000-000000000002';
select pg_temp.as_user('60000000-0000-4000-a000-000000000002');
set local role authenticated;
select ok((knowledge.retrieval_context() -> 'configuration' -> 'notReady') ? 'model',
  'en hybrid konfiguration, hvis model ikke er den aktive, er fortsat ikke klar (model)');
reset role;
update knowledge.embedding_models set status = 'candidate', activated_at = null where id = '61000000-0000-4000-a000-000000000002';
update knowledge.embedding_models set status = 'active', retired_at = null where id in (select id from pgtap_active_model);

-- Materialet
select is(knowledge.document_retrieval_material_problem(pg_temp.doc_material(360000)), null, 'et gyldigt product_documents-materiale har intet problem');
select is(knowledge.retrieval_material_method(pg_temp.doc_material(360000)), 'product_documents', 'metoden læses af materialet');
select is(knowledge.retrieval_material_method(pg_temp.base_report() #> '{configuration,declared}'), 'hybrid', 'et materiale uden "method" er hybridt (8B uændret)');
select is(knowledge.retrieval_material_problem(m), msg, format('materialet afvises: %s', msg))
from (values
  (jsonb_set(pg_temp.doc_material(360000), '{embedding}', pg_temp.base_report() #> '{configuration,declared,embedding}'), 'metoden product_documents har ingen embedding-model'),
  (jsonb_set(pg_temp.doc_material(360000), '{reranker}', pg_temp.base_report() #> '{configuration,declared,reranker}'), 'metoden product_documents har ingen reranker'),
  (jsonb_set(pg_temp.doc_material(360000), '{method}', '"hybrid"'), 'ukendt retrieval-metode'),
  (pg_temp.doc_material(360000) || '{"topK": 8}', 'materialet har ikke de definerende felter'),
  (jsonb_set(pg_temp.doc_material(360000), '{algorithmVersion}', '"hybrid-rrf-1"'), 'algoritmeversionen er ugyldig'),
  (pg_temp.doc_material(9999), 'parameteren maxChars er ugyldig'),
  (jsonb_set(pg_temp.doc_material(360000), '{params,maxChars}', '20000.5'), 'parameteren maxChars er ugyldig'),
  (jsonb_set(pg_temp.doc_material(360000), '{params}', '{"maxChars": 20000, "minScore": 0.1}'), 'parametrene er ufuldstændige'),
  (jsonb_set(pg_temp.doc_material(360000), '{chunkerVersions}', '[]'), 'chunker-versionerne er ugyldige')
) as t(m, msg);
select ok(not knowledge.retrieval_material_is_development(pg_temp.doc_material(360000)), 'en gyldig product_documents-konfiguration er ikke en udviklingskonfiguration');
select ok(knowledge.retrieval_material_is_development(jsonb_set(pg_temp.doc_material(360000), '{reranker}', '{"id": "none"}')),
  'et ugyldigt product_documents-materiale er altid en udviklingskonfiguration');
select ok(knowledge.retrieval_material_is_development(pg_temp.material('{reranker,id}', '"none"')), 'et hybridt materiale med "none" er fortsat en udviklingskonfiguration');

-- Embedding-modellen følger metoden (constraint), uanset vej ind.
select throws_ok($$ select set_config('knowledge.registry_write', 'on', true);
  insert into knowledge.retrieval_configurations (label, version, material, fingerprint, embedding_model_id, created_by_role)
  values ('pgtap-x', 1, pg_temp.doc_material(360000), knowledge.retrieval_fingerprint(pg_temp.doc_material(360000)), (select id from pgtap_model), 'test') $$,
  '23514', null, 'en konfiguration uden embedding kan ikke pege på en embedding-model');
select throws_ok($$ select set_config('knowledge.registry_write', 'on', true);
  insert into knowledge.retrieval_configurations (label, version, material, fingerprint, embedding_model_id, created_by_role)
  values ('pgtap-y', 1, pg_temp.material('{params,minScore}', '0.33'), knowledge.retrieval_fingerprint(pg_temp.material('{params,minScore}', '0.33')), null, 'test') $$,
  '23514', null, 'en hybrid konfiguration skal have sin embedding-model');
select set_config('knowledge.registry_write', '', true);

-- B-036: product_documents har sit eget, versionsstyrede gate-sæt (D1–D6). Det gælder netop den metode.
create temp table pgtap_doc_gate as select pg_temp.register_gates(pg_temp.doc_gates()) as id;
grant select on pgtap_doc_gate to public;
select ok((select method = 'product_documents' and k is null and approved_at is null from knowledge.evaluation_gate_sets where id = (select id from pgtap_doc_gate)),
  'dokumentgate-sættet registreres ugodkendt, for metoden product_documents og uden K');
select ok((select method = 'hybrid' and k = 8 from knowledge.evaluation_gate_sets where id = (select id from pgtap_gate)),
  'det hybride gate-sæt (8B) er uændret: metoden hybrid og K = 8');
select throws_like(format($$ select pg_temp.register_gates(%L) $$, g), msg, format('dokumentgate-sættet afvises: %s', descr))
from (values
  (jsonb_set(pg_temp.doc_gates(), '{quality,D4,threshold}', '0.9'), '%D4 har ikke den låste metrik, retning og tærskel 1%', 'en lavere tærskel'),
  (jsonb_set(pg_temp.doc_gates(), '{quality,D3,metric}', '"valid_version_coverage"'), '%D3 har ikke den låste%', 'en anden metrik'),
  (jsonb_set(pg_temp.doc_gates(), '{quality,D1,comparator}', '"<="'), '%D1 har ikke den låste%', 'en anden retning'),
  ((pg_temp.doc_gates() #- '{quality,D6}'), '%ikke præcis D1–D6%', 'en manglende gate'),
  (jsonb_set(pg_temp.doc_gates(), '{quality,Q1}', '{"metric": "source_recall_at_k", "comparator": ">=", "threshold": 0.95}'), '%ikke præcis D1–D6%', 'en Q-gate i et dokumentgate-sæt'),
  (jsonb_set(pg_temp.doc_gates(), '{method}', '"hybrid"'), '%metode er ukendt%', 'en anden metode'),
  (pg_temp.doc_gates() || '{"k": 8}', '%forventede felter%', 'et K')
) as t(g, msg, descr);
select pg_temp.as_user('60000000-0000-4000-a000-000000000001');
set local role authenticated;
select lives_ok(format($$ select knowledge.approve_evaluation_gate_set(%L) $$, (select id from pgtap_doc_gate)),
  'en administrator med system.settings.manage godkender dokumentgate-sættet');
reset role;

-- Et gate-sæt kan kun evaluere — og dermed godkende — sin egen metode.
select throws_like($$ select pg_temp.publish(pg_temp.reseal(jsonb_set(pg_temp.doc_report(360000, 'run-pdq'), '{gateSet}', pg_temp.base_report() -> 'gateSet'))) $$,
  '%Afvist (gate_set)%gælder retrieval-metoden "hybrid", men konfigurationen bruger "product_documents"%',
  'Q1–Q7 (gates-v1) kan ikke godkende en product_documents-konfiguration');
select throws_like($$ select pg_temp.publish(pg_temp.reseal(jsonb_set(pg_temp.with_run(pg_temp.base_report(), 'run-hyd'), '{gateSet}', pg_temp.doc_report(360000, 'x') -> 'gateSet'))) $$,
  '%Afvist (gate_set)%gælder retrieval-metoden "product_documents", men konfigurationen bruger "hybrid"%',
  'D1–D6 kan ikke godkende en hybrid konfiguration');
select throws_like($$ select pg_temp.publish(pg_temp.reseal(jsonb_set(pg_temp.doc_report(360000, 'run-pdr'), '{gateSet,method}', '"hybrid"'))) $$,
  '%Afvist (gate_set)%anderledes end registret%', 'en rapport, der angiver en anden metode for gate-sættet, afvises');

-- Genberegning af en product_documents-rapport: forfalskninger afvises, også med nye checksums.
select throws_like(format($$ select pg_temp.publish(pg_temp.reseal(%L::jsonb)) $$, r), msg, format('en forfalsket dokumentrapport afvises: %s', descr))
from (values
  (jsonb_set(pg_temp.doc_report(360000, 'run-pdf1'), '{metrics,valid_version_coverage,value}', '0.5'), '%Afvist (recomputation)%valid_version_coverage kan ikke genberegnes%', 'en redigeret metrik'),
  (jsonb_set(pg_temp.doc_report(360000, 'run-pdf2'), '{qualityGates,3,uncertain}', 'true'), '%Afvist (recomputation)%Dokumentgate D4%', 'en dokumentgate markeret usikker'),
  (jsonb_set(pg_temp.doc_report(360000, 'run-pdf3'), '{qualityGates,0,threshold}', '0.5'), '%Afvist (recomputation)%Dokumentgate D1%', 'en anden tærskel i resultatet'),
  (jsonb_set(pg_temp.doc_report(360000, 'run-pdf4'), '{rerankerComparison}', pg_temp.base_report() -> 'rerankerComparison'), '%ingen sammenligning uden reranker%', 'en reranker-sammenligning'),
  ((pg_temp.doc_report(360000, 'run-pdf5') #- '{cases,0,documents}'), '%observation har ikke den forventede form%', 'en observation uden dokumentobservation'),
  (jsonb_set(pg_temp.doc_report(360000, 'run-pdf6'), '{cases,0,documents,missingVersions}', '3'), '%observation har ikke den forventede form%', 'umulige tællinger'),
  (jsonb_set(pg_temp.doc_report(360000, 'run-pdf7'), '{cases,0,documents,incompleteVersions}', '1'), '%full_document_integrity kan ikke genberegnes%', 'en ufuldstændig version bag en bestået metrik'),
  (jsonb_set(pg_temp.doc_report(360000, 'run-pdf8'), '{verdict}', '"uncertain"'), '%Afgørelsen stemmer ikke%', 'en dokumentkørsel erklæret usikker'),
  (jsonb_set(pg_temp.doc_report(360000, 'run-pdf9'), '{metrics,source_recall_at_k}', pg_temp.base_report() #> '{metrics,source_recall_at_k}'), '%ikke præcis dokumentmetrikkerne%', 'en Q-metrik i en dokumentrapport')
) as t(r, msg, descr);

-- Kravene bag D1–D6 pr. spørgsmål (metrics.ts DOCUMENT_CASE_CHECKS): hver halvdel af hvert krav.
create function pg_temp.docs(p_change jsonb) returns jsonb language sql immutable as $f$
  select '{"expectedVersions": 2, "deliveredVersions": 2, "missingVersions": 0, "unexpectedVersions": 0, "missingDocuments": 0, "unexpectedDocuments": 0,
           "incompleteVersions": 0, "productQueried": true, "foreignProductItems": 0, "requiredDocuments": 1, "requiredDocumentsCovered": 1,
           "requiredPassages": 1, "requiredPassagesCovered": 1}'::jsonb || p_change
$f$;
select is(knowledge.document_case_meets(metric, pg_temp.docs(change)), expected, format('%s med %s', metric, change))
from (values
  ('required_document_coverage', '{}'::jsonb, true), ('required_document_coverage', '{"requiredDocumentsCovered": 0}', false), ('required_document_coverage', '{"requiredDocuments": 0, "requiredDocumentsCovered": 0}', false),
  ('required_passage_coverage', '{"requiredPassagesCovered": 0}', false), ('required_passage_coverage', '{"requiredPassages": 0, "requiredPassagesCovered": 0}', false),
  ('full_document_integrity', '{"incompleteVersions": 1}', false),
  ('valid_version_coverage', '{"missingVersions": 1}', false), ('valid_version_coverage', '{"unexpectedVersions": 1}', false),
  ('correct_product_scope', '{"productQueried": false}', false), ('correct_product_scope', '{"foreignProductItems": 1}', false),
  ('authorized_document_coverage', '{"missingDocuments": 1}', false), ('authorized_document_coverage', '{"unexpectedDocuments": 1}', false)
) as t(metric, change, expected);
select is(knowledge.document_case_meets('valid_version_coverage', 'null'::jsonb), false, 'uden dokumentobservation (fejlet retrieval) opfyldes intet krav');

-- En kørsel, hvor ét spørgsmål mangler en gyldig version (D4), registreres som ikke bestået og kan
-- ikke godkendes (en anden konfiguration end pgtap-documents, så den ikke er dens seneste kørsel).
insert into pgtap_runs select 'pdx', pg_temp.publish(pg_temp.reseal(jsonb_set(pg_temp.doc_report_from(pg_temp.ts_doc_missing(), 370000, 'run-pdx'),
  '{configuration,label}', '"pgtap-doc-missing"')));
select ok((select not quality_gates_passed and verdict = 'fail' and hard_gates_passed and valid
           and (quality_gates -> 3) @> '{"id": "D4", "status": "fail"}'::jsonb
           from knowledge.evaluation_runs where id = (select id from pgtap_runs where name = 'pdx')),
  'én manglende gyldig version fejler D4 (invariant) — kørslen er gyldig, men ikke bestået');
select pg_temp.as_user('60000000-0000-4000-a000-000000000001');
set local role authenticated;
select throws_like(format($$ select knowledge.approve_retrieval_configuration(%L, %L, '[]') $$,
    (select configuration_id from knowledge.evaluation_runs where id = (select id from pgtap_runs where name = 'pdx')), (select id from pgtap_runs where name = 'pdx')),
  '%kvalitetsgate er ikke bestået%', 'og konfigurationen kan ikke godkendes');
reset role;

-- Registrering: samme vej som en hybrid konfiguration; erklæret og runtime skal være samme metode.
select throws_like($$ select pg_temp.publish(pg_temp.reseal(jsonb_set(jsonb_set(jsonb_set(pg_temp.doc_report(360000, 'run-pdm'),
    '{configuration,runtime}', pg_temp.base_report() #> '{configuration,declared}'),
    '{configuration,runtimeFingerprint}', to_jsonb(knowledge.retrieval_fingerprint(pg_temp.base_report() #> '{configuration,declared}'))),
    '{configuration,matches}', 'false'))) $$,
  '%Afvist (configuration)%anden retrieval-metode%', 'en kørsel, der brugte en anden metode end den erklærede, afvises');
insert into pgtap_runs select 'pd1', pg_temp.publish(pg_temp.doc_report(360000, 'run-pd1'));
select ok((select status = 'candidate' and embedding_model_id is null and reranker_id is null
           from knowledge.retrieval_configurations where id = pg_temp.cfg('pgtap-documents')),
  'product_documents registreres som kandidat uden embedding-model og reranker');

-- Ingen automatisk production-evidens: en kandidat giver intet beredskab.
select pg_temp.as_user('60000000-0000-4000-a000-000000000002');
set local role authenticated;
select isnt(knowledge.retrieval_context() #>> '{configuration,id}', pg_temp.cfg('pgtap-documents')::text, 'en registreret kandidat er ikke i drift');
select throws_ok(format($$ select knowledge.approve_retrieval_configuration(%L, %L, '[]') $$, pg_temp.cfg('pgtap-documents'), (select id from pgtap_runs where name = 'pd1')),
  '42501', null, 'en rådgiver kan ikke godkende');
reset role;

-- Godkendelse og aktivering af et menneske med system.settings.manage; modellerne røres ikke.
create temp table pgtap_models_before as select id, status from knowledge.embedding_models;
grant select on pgtap_models_before to public;
select pg_temp.as_user('60000000-0000-4000-a000-000000000001');
set local role authenticated;
select lives_ok(format($$ select knowledge.approve_retrieval_configuration(%L, %L, '[]') $$, pg_temp.cfg('pgtap-documents'), (select id from pgtap_runs where name = 'pd1')),
  'en administrator godkender konfigurationen efter den beståede, registrerede kørsel');
select lives_ok(format($$ select knowledge.activate_retrieval_configuration(%L) $$, pg_temp.cfg('pgtap-documents')),
  'og aktiverer den');
reset role;
select is((select status from knowledge.retrieval_configurations where id = pg_temp.cfg('pgtap-documents')), 'active', 'product_documents er i drift');
select ok(not exists (select 1 from knowledge.embedding_models m join pgtap_models_before b on b.id = m.id where m.status <> b.status),
  'aktiveringen ændrer ingen embedding-model');

-- Retrieval-konteksten: metoden, ingen model eller reranker, beredskab uafhængigt af den aktive model.
select pg_temp.as_user('60000000-0000-4000-a000-000000000002');
set local role authenticated;
select ok((select c -> 'configuration' @> '{"method": "product_documents", "embeddingModelId": null, "rerankerId": null, "productionReady": true, "notReady": []}'::jsonb
           from knowledge.retrieval_context() c),
  'retrieval-konteksten melder metoden og beredskab uden embedding-model og reranker');
reset role;
update knowledge.embedding_models set status = 'retired', retired_at = now() where status = 'active';
select pg_temp.as_user('60000000-0000-4000-a000-000000000002');
set local role authenticated;
select is(knowledge.retrieval_context() #>> '{configuration,productionReady}', 'true', 'også uden nogen aktiv embedding-model');
reset role;

-- knowledge.product_document_chunks: som brugeren, gennem RLS og adgangsfiltret.
insert into auth.users (id, email, aud, role, raw_user_meta_data) values
  ('60000000-0000-4000-a000-0000000000d3', 'r.adv-d3@ipa.test', 'authenticated', 'authenticated', '{"display_name":"pgTAP Rådgiver uden adgang"}');
insert into identity.user_roles (user_id, role_id)
select u.id, r.id from identity.users u join identity.roles r on r.key = 'advisor' where u.auth_id = '60000000-0000-4000-a000-0000000000d3';
insert into knowledge.document_access_grants (document_id, permission_key, grantee_type, user_id)
select '63000000-0000-4000-a000-000000000001'::uuid, 'knowledge.document.read', 'user', u.id from identity.users u
where u.auth_id = '60000000-0000-4000-a000-000000000002';

select ok(not has_function_privilege(r, 'knowledge.product_document_chunks(uuid,text,date,text,uuid[],text[],int)', 'EXECUTE'),
  format('%s kan ikke køre product_document_chunks', r))
from unnest(array['anon', 'service_role']) r;

select pg_temp.as_user('60000000-0000-4000-a000-000000000002');
set local role authenticated;
select is((select array_agg(chunk_id::text || ':' || version_chunk_count) from knowledge.product_document_chunks('62000000-0000-4000-a000-000000000001')),
  array['65000000-0000-4000-a000-000000000001:1'],
  'rådgiveren med adgang får hele den publicerede version — og kun den (versionen under behandling indgår ikke)');
select is((select count(*)::int from knowledge.product_document_chunks('62000000-0000-4000-a000-000000000001', p_document_types => array['acceptance_rules'])), 0,
  'dokumenttyperne kan kun snævre ind');
select throws_ok($$ select * from knowledge.product_document_chunks(null) $$, '22023', null, 'et produkt er påkrævet');
select throws_ok($$ select * from knowledge.product_document_chunks('62000000-0000-4000-a000-000000000001', p_max_chars => 5) $$, '22023', null, 'budgettet skal være gyldigt');
select throws_ok($$ select * from knowledge.product_document_chunks('62000000-0000-4000-a000-000000000001', 'as_of') $$, '22023', null, 'historisk opslag kræver en dato');
select is((select count(*)::int from knowledge.product_document_chunks('62000000-0000-4000-a000-000000000001', 'as_of', '2019-06-01')), 0,
  'en dato før versionens gyldighed giver intet');
reset role;
select pg_temp.as_user('60000000-0000-4000-a000-0000000000d3');
set local role authenticated;
select is((select count(*)::int from knowledge.product_document_chunks('62000000-0000-4000-a000-000000000001')), 0,
  'en rådgiver uden adgang til dokumentet får intet (RLS og adgangsfiltret)');
reset role;

-- B-036 (mutation S02): for en forvalter (knowledge.document.write) lader RLS alle versioner
-- igennem. Adgangsfiltret i funktionen er da det eneste lag, der håndhæver læseretten: en redaktør
-- uden knowledge.document.read og uden tildeling får intet.
insert into identity.roles (key, name, description) values ('pgtap_editor', 'pgTAP Redaktør', 'Kun knowledge.document.write (testrolle)');
insert into identity.role_permissions (role_id, permission_id, scope)
select r.id, p.id, 'all' from identity.roles r, identity.permissions p where r.key = 'pgtap_editor' and p.key = 'knowledge.document.write';
insert into auth.users (id, email, aud, role, raw_user_meta_data) values
  ('60000000-0000-4000-a000-0000000000e1', 'r.editor-e1@ipa.test', 'authenticated', 'authenticated', '{"display_name":"pgTAP Redaktør uden læseret"}');
insert into identity.user_roles (user_id, role_id)
select u.id, r.id from identity.users u join identity.roles r on r.key = 'pgtap_editor' where u.auth_id = '60000000-0000-4000-a000-0000000000e1';
select pg_temp.as_user('60000000-0000-4000-a000-0000000000e1');
set local role authenticated;
select ok(exists (select 1 from knowledge.document_chunks c where c.id = '65000000-0000-4000-a000-000000000001'),
  'RLS lader redaktøren (forvalter) se chunks uden læseret');
select is((select count(*)::int from knowledge.product_document_chunks('62000000-0000-4000-a000-000000000001')), 0,
  'men product_document_chunks udleverer intet uden læseret — adgangsfiltret er her det eneste lag');
reset role;

-- Over budgettet afvises kaldet; det afkortes aldrig.
insert into knowledge.documents (id, product_id, document_type, source_id, title)
select '63000000-0000-4000-a000-0000000000d3', '62000000-0000-4000-a000-000000000001', 'terms', id, 'pgTAP Lange betingelser'
from knowledge.sources where type = 'manual_upload';
insert into knowledge.document_versions (id, document_id, version_label, valid_from, storage_path, checksum_sha256)
values ('64000000-0000-4000-a000-0000000000d3', '63000000-0000-4000-a000-0000000000d3', '1', '2020-01-01', 'r/d3.pdf', repeat('6', 64));
select pg_temp.release('64000000-0000-4000-a000-0000000000d3');
update knowledge.document_versions set status = 'processing' where id = '64000000-0000-4000-a000-0000000000d3';
insert into knowledge.document_chunks (id, document_version_id, chunk_index, kind, text, heading_path, page_start, page_end,
  char_start, char_end, content_hash, char_count, token_estimate)
values ('65000000-0000-4000-a000-0000000000d3', '64000000-0000-4000-a000-0000000000d3', 0, 'prose', repeat('Fiktiv betingelse. ', 600), '{}', 1, 1, 0, 11400, repeat('5', 64), 11400, 2850);
update knowledge.document_versions set chunker_version = 'structure/1', status = 'processed' where id = '64000000-0000-4000-a000-0000000000d3';
update knowledge.document_versions set status = 'under_review' where id = '64000000-0000-4000-a000-0000000000d3';

-- B-036 (mutationer S04/S13): RLS lader en forvalter se en version under review. Statusfiltret og
-- adgangsfiltret (can_read_version kræver "published") holder den hver for sig ude af grundlaget.
select pg_temp.as_user('60000000-0000-4000-a000-000000000001');
set local role authenticated;
select ok(exists (select 1 from knowledge.document_versions where id = '64000000-0000-4000-a000-0000000000d3'),
  'RLS lader forvalteren se versionen under review');
select ok(not knowledge.can_read_version('64000000-0000-4000-a000-0000000000d3', 'any'),
  'can_read_version afviser en upubliceret version — også for en forvalter med alle rettigheder');
select is((select count(*)::int from knowledge.product_document_chunks('62000000-0000-4000-a000-000000000001')
           where version_id = '64000000-0000-4000-a000-0000000000d3'), 0,
  'product_document_chunks udleverer aldrig en upubliceret version');
reset role;

-- K2: uden aktiv embedding-model kræver publicering ikke embeddings; de andre blokeringer gælder.
select ok(not knowledge.publication_requires_embeddings(), 'uden aktiv embedding-model kræves ingen embeddings');
select pg_temp.as_user('60000000-0000-4000-a000-000000000001');
set local role authenticated;
select ok(not (knowledge.review_state('64000000-0000-4000-a000-0000000000d3') -> 'blockers') @> '[{"code": "embeddings_missing"}]',
  'review-tilstanden har ingen embedding-blokering uden aktiv model');
reset role;
update knowledge.embedding_models set status = 'active', activated_at = now(), retired_at = null where id = (select id from pgtap_model);
select ok(knowledge.publication_requires_embeddings(), 'med en aktiv embedding-model kræves embeddings');
select pg_temp.as_user('60000000-0000-4000-a000-000000000001');
set local role authenticated;
select ok((knowledge.review_state('64000000-0000-4000-a000-0000000000d3') -> 'blockers') @> '[{"code": "embeddings_missing"}]',
  'og versionen uden embeddings kan ikke godkendes, så længe modellen er aktiv');
reset role;
update knowledge.embedding_models set status = 'retired', retired_at = now() where id = (select id from pgtap_model);
update knowledge.document_versions set status = 'published', approved_at = now(), published_at = now() where id = '64000000-0000-4000-a000-0000000000d3';

select pg_temp.as_user('60000000-0000-4000-a000-000000000001');
set local role authenticated;
select throws_ok($$ select * from knowledge.product_document_chunks('62000000-0000-4000-a000-000000000001', p_max_chars => 10000) $$,
  '54000', null, 'et grundlag over budgettet afvises — det afkortes aldrig');
select is((select count(*)::int from knowledge.product_document_chunks('62000000-0000-4000-a000-000000000001', p_max_chars => 20000)), 2,
  'inden for budgettet: begge publicerede versioner i fuld længde');
reset role;

-- B-036: gate-sættets metode efterprøves også ved godkendelse og i retrieval-konteksten (forsvar i
-- dybden; registreringen afviser allerede kombinationen). Kørslens gate-sæt forfalskes direkte — kun
-- muligt for ejeren med append-only-triggeren slået fra, inden for testens transaktion.
alter table knowledge.evaluation_runs disable trigger evaluation_runs_append_only;
update knowledge.evaluation_runs set gate_set_id = (select id from pgtap_gate) where id = (select id from pgtap_runs where name = 'pd1');
select ok('gate-sættet gælder en anden retrieval-metode end konfigurationen' = any (
    knowledge.retrieval_configuration_problems(pg_temp.cfg('pgtap-documents'), (select id from pgtap_runs where name = 'pd1'))),
  'godkendelsen finder et gate-sæt for en anden metode');
select pg_temp.as_user('60000000-0000-4000-a000-000000000002');
set local role authenticated;
select ok((knowledge.retrieval_context() -> 'configuration' -> 'notReady') ? 'gate_set',
  'og retrieval-konteksten giver intet beredskab');
reset role;
update knowledge.evaluation_runs set gate_set_id = (select id from pgtap_doc_gate) where id = (select id from pgtap_runs where name = 'pd1');
alter table knowledge.evaluation_runs enable trigger evaluation_runs_append_only;
select pg_temp.as_user('60000000-0000-4000-a000-000000000002');
set local role authenticated;
select is(knowledge.retrieval_context() #>> '{configuration,productionReady}', 'true', 'med det rigtige gate-sæt er konfigurationen klar igen');
reset role;

-- ----------------------------------------------------------------------------
-- 15. B-036: tre adskilte godkendelser — retrieval-konfiguration, AI-svarkvalitet, beta
-- ----------------------------------------------------------------------------

create function pg_temp.graded(p_n int, p_model text, p_bad int default 0,
    p_categories text[] default array['direct', 'exception', 'multi_clause', 'missing_coverage', 'similar_product', 'historical', 'conflict', 'unanswerable', 'permission'])
returns jsonb language sql stable as $f$
  select jsonb_build_object(
    'criteria', jsonb_build_object('id', 'beta-answer-acceptance', 'version', 1),
    'evalSet', jsonb_build_object('id', 'pgtap-e2e', 'version', 1, 'checksum', repeat('e', 64)),
    'retrievalConfigurationId', pg_temp.cfg('pgtap-documents'),
    'model', jsonb_build_object('id', p_model, 'version', '1'),
    'profile', jsonb_build_object('id', 'copilot', 'version', '1'),
    'results', (select jsonb_agg(jsonb_build_object(
        'caseId', 'e2e-' || i,
        'category', c,
        'correctness', case when i <= p_bad then 'partial' else 'full' end,
        'critical', false,
        'inventedCitation', false,
        'exceptions', case when c = 'exception' then 'correct' else 'not_applicable' end,
        'refusal', case when c in ('unanswerable', 'permission') then 'correct' else 'not_applicable' end) order by i)
      from (select i, p_categories[1 + (i - 1) % cardinality(p_categories)] as c from generate_series(1, p_n) i) g))
$f$;
create function pg_temp.record_answers(p jsonb) returns uuid language plpgsql as $f$
declare v uuid;
begin
  perform pg_temp.as_user('60000000-0000-4000-a000-000000000001');
  set local role authenticated;
  v := ai.record_answer_quality(p);
  reset role;
  return v;
end $f$;
create function pg_temp.answers(p_id uuid) returns ai.answer_quality_validations language sql stable as $f$
  select * from ai.answer_quality_validations where id = p_id
$f$;

select pg_temp.as_user('60000000-0000-4000-a000-000000000002');
set local role authenticated;
select throws_ok($$ select ai.record_answer_quality(pg_temp.graded(40, 'claude-sonnet-5-5')) $$, '42501', null, 'en rådgiver kan ikke registrere en svarbedømmelse');
select throws_ok($$ select ai.beta_status() $$, '42501', null, 'en rådgiver kan ikke se betaens godkendelser');
reset role;

select pg_temp.as_user('60000000-0000-4000-a000-000000000001');
set local role authenticated;
select ok(ai.beta_status() @> '{"retrievalConfigurationApproved": true, "answerQualityValidated": false, "betaApprovedForAdvisers": false}'::jsonb,
  'en godkendt og aktiv retrieval-konfiguration medfører hverken valideret svarkvalitet eller betagodkendelse');
reset role;

-- Kriterierne (låste): hver mangel giver sit problem, og intet bliver valideret ved registreringen.
create temp table pgtap_answers (name text primary key, id uuid);
grant select on pgtap_answers to public;
insert into pgtap_answers values
  ('stub', pg_temp.record_answers(pg_temp.graded(40, 'stub'))),
  ('few', pg_temp.record_answers(pg_temp.graded(39, 'claude-sonnet-5-5'))),
  ('wrong', pg_temp.record_answers(pg_temp.graded(40, 'claude-sonnet-5-5', 3))),
  ('critical', pg_temp.record_answers(jsonb_set(pg_temp.graded(40, 'claude-sonnet-5-5'), '{results,0,critical}', 'true'))),
  ('invented', pg_temp.record_answers(jsonb_set(pg_temp.graded(40, 'claude-sonnet-5-5'), '{results,1,inventedCitation}', 'true'))),
  ('exception', pg_temp.record_answers(jsonb_set(pg_temp.graded(40, 'claude-sonnet-5-5'), '{results,1,exceptions}', '"incorrect"'))),
  ('refusal', pg_temp.record_answers(jsonb_set(pg_temp.graded(40, 'claude-sonnet-5-5'), '{results,7,refusal}', '"missing"'))),
  ('category', pg_temp.record_answers(pg_temp.graded(40, 'claude-sonnet-5-5', 0, array['direct', 'exception', 'multi_clause', 'missing_coverage', 'similar_product', 'historical', 'conflict', 'unanswerable']))),
  ('passing', pg_temp.record_answers(pg_temp.graded(40, 'claude-sonnet-5-5', 2)));
select is((pg_temp.answers(id)).criteria_met, false, format('kriterierne er ikke opfyldt: %s', name)) from pgtap_answers where name <> 'passing' order by name;
select ok(exists (select 1 from unnest((pg_temp.answers((select id from pgtap_answers where name = n))).problems) p where p like pattern), format('problemet nævnes: %s', n))
from (values ('stub', '%"stub" er ikke en rigtig Claude-model%'), ('few', 'for få spørgsmål: 39%'), ('wrong', '37 af 40 fuldt korrekte%'),
             ('critical', '1 kritiske fejl'), ('invented', '1 opdigtede kildehenvisninger'), ('exception', '1 fejl i undtagelser%'),
             ('refusal', '1 manglende eller uberettigede afvisninger'), ('category', 'kategorier uden spørgsmål: permission')) as t(n, pattern);
select is((pg_temp.answers(id)).fully_correct, 39, format('et svar med %s er ikke fuldt korrekt', name))
from pgtap_answers where name in ('critical', 'invented', 'exception', 'refusal') order by name;
select ok((select criteria_met and cardinality(problems) = 0 and questions = 40 and fully_correct = 38 and validated_at is null
                  and fully_correct_lower_bound between 0.83 and 0.84
           from ai.answer_quality_validations where id = (select id from pgtap_answers where name = 'passing')),
  '38 af 40 (95 %) opfylder kriterierne — men er ikke valideret; usikkerheden (nedre grænse ca. 0,83) gemmes');
select throws_like($$ select pg_temp.record_answers(jsonb_set(pg_temp.graded(40, 'claude-sonnet-5-5'), '{results,1,exceptions}', '"not_applicable"')) $$,
  '%skal bedømmes på undtagelserne%', 'et spørgsmål om undtagelser kan ikke bedømmes "ikke relevant"');
select throws_like($$ select pg_temp.record_answers(jsonb_set(pg_temp.graded(40, 'claude-sonnet-5-5'), '{results,1,caseId}', '"e2e-1"')) $$,
  '%bedømt mere end én gang%', 'et spørgsmål kan ikke bedømmes to gange');

select pg_temp.as_user('60000000-0000-4000-a000-000000000001');
set local role authenticated;
select ok(ai.beta_status() @> '{"answerQualityValidated": false, "betaApprovedForAdvisers": false}'::jsonb,
  'opfyldte kriterier er ikke en valideret svarkvalitet');
reset role;

-- Faglig, menneskelig validering.
select pg_temp.as_user('60000000-0000-4000-a000-000000000002');
set local role authenticated;
select throws_ok(format($$ select ai.validate_answer_quality(%L, 'Fagligt gennemgået.', true) $$, (select id from pgtap_answers where name = 'passing')),
  '42501', null, 'en rådgiver kan ikke validere svarkvaliteten');
reset role;
select pg_temp.as_user('60000000-0000-4000-a000-000000000001');
set local role authenticated;
select throws_like(format($$ select ai.validate_answer_quality(%L, 'Fagligt gennemgået.', true) $$, (select id from pgtap_answers where name = 'stub')),
  '%Kriterierne er ikke opfyldt%', 'stub-modellens svar kan aldrig valideres');
select throws_like(format($$ select ai.validate_answer_quality(%L, 'Fagligt gennemgået.', false) $$, (select id from pgtap_answers where name = 'passing')),
  '%usikkerhed%skal accepteres eksplicit%', 'valideringen kræver en eksplicit accept af den statistiske usikkerhed');
select throws_like(format($$ select ai.validate_answer_quality(%L, 'ok', true) $$, (select id from pgtap_answers where name = 'passing')),
  '%begrundelse%', 'valideringen kræver en faglig begrundelse');
select lives_ok(format($$ select ai.validate_answer_quality(%L, 'Fagligt gennemgået af produktansvarlig.', true) $$, (select id from pgtap_answers where name = 'passing')),
  'en person med knowledge.version.publish validerer svarkvaliteten');
select throws_like(format($$ select ai.validate_answer_quality(%L, 'Fagligt gennemgået igen.', true) $$, (select id from pgtap_answers where name = 'passing')),
  '%allerede valideret%', 'en validering sker én gang');
select throws_ok($$ insert into ai.answer_quality_validations (criteria_id) values ('beta-answer-acceptance') $$, '42501', null,
  'ingen kan skrive direkte i svarvalideringerne');
select ok(ai.beta_status() @> '{"retrievalConfigurationApproved": true, "answerQualityValidated": true, "betaApprovedForAdvisers": false}'::jsonb,
  'en valideret svarkvalitet medfører ikke en betagodkendelse');
reset role;
select throws_like(format($$ update ai.answer_quality_validations set criteria_met = true where id = %L $$, (select id from pgtap_answers where name = 'stub')),
  '%ændres kun gennem%', 'heller ikke ejeren kan rette en svarvalidering uden om funktionerne');
select ok(exists (select 1 from audit.audit_log where action = 'ai.answer_quality.validated' and entity_id = (select id from pgtap_answers where name = 'passing')::text),
  'valideringen er auditeret');

-- Betaversion godkendt til rådgivere: kræver begge dele og et menneske.
select pg_temp.as_user('60000000-0000-4000-a000-000000000001');
set local role authenticated;
select throws_like(format($$ select ai.approve_beta_release('beta-1', %L, 'Klar til de første rådgivere.') $$, (select id from pgtap_answers where name = 'wrong')),
  '%kræver en valideret svarkvalitet%', 'betaen kan ikke godkendes uden valideret svarkvalitet');
reset role;
select pg_temp.as_user('60000000-0000-4000-a000-000000000002');
set local role authenticated;
select throws_ok(format($$ select ai.approve_beta_release('beta-1', %L, 'Klar til de første rådgivere.') $$, (select id from pgtap_answers where name = 'passing')),
  '42501', null, 'en rådgiver kan ikke godkende betaen');
reset role;
select pg_temp.as_user('60000000-0000-4000-a000-000000000001');
set local role authenticated;
create temp table pgtap_beta as select ai.approve_beta_release('beta-1', (select id from pgtap_answers where name = 'passing'), 'Klar til de første rådgivere.') as id;
select ok(ai.beta_status() @> '{"retrievalConfigurationApproved": true, "answerQualityValidated": true, "betaApprovedForAdvisers": true, "betaLabel": "beta-1"}'::jsonb,
  'først med en aktiv retrieval-konfiguration, en valideret svarkvalitet og en menneskelig betagodkendelse er betaen godkendt');
select lives_ok(format($$ select ai.revoke_beta_release(%L, 'Trukket tilbage i pgTAP.') $$, (select id from pgtap_beta)), 'betagodkendelsen kan trækkes tilbage');
select ok(ai.beta_status() @> '{"answerQualityValidated": true, "betaApprovedForAdvisers": false}'::jsonb, 'og så er betaen ikke længere godkendt');
select lives_ok(format($$ select ai.approve_beta_release('beta-2', %L, 'Godkendt igen efter rettelse.') $$, (select id from pgtap_answers where name = 'passing')),
  'en ny betagodkendelse');
reset role;

-- En fejlet hård gate i regression suspenderer også en product_documents-konfiguration (D-8).
insert into pgtap_runs select 'pd2', pg_temp.publish(pg_temp.with_h1_breach(pg_temp.doc_report(360000, 'run-pd2'), 'run-pd2'));
select is((select status from knowledge.retrieval_configurations where id = pg_temp.cfg('pgtap-documents')), 'suspended',
  'et H1-brud suspenderer product_documents straks');
select pg_temp.as_user('60000000-0000-4000-a000-000000000002');
set local role authenticated;
select is(knowledge.retrieval_context() #>> '{configuration,productionReady}', 'false', 'og der kan ikke udstedes production-evidens');
reset role;
-- B-036: en suspenderet retrieval-konfiguration tager betagodkendelsen med sig — men ikke valideringen.
select pg_temp.as_user('60000000-0000-4000-a000-000000000001');
set local role authenticated;
select ok(ai.beta_status() @> '{"retrievalConfigurationApproved": false, "answerQualityValidated": true, "betaApprovedForAdvisers": false}'::jsonb,
  'efter suspenderingen er hverken retrieval-konfigurationen eller betaen godkendt');
select throws_like(format($$ select ai.approve_beta_release('beta-3', %L, 'Forsøg under suspendering.') $$, (select id from pgtap_answers where name = 'passing')),
  '%den aktive%', 'og betaen kan ikke godkendes, mens konfigurationen er suspenderet');
reset role;

select * from finish();
rollback;
