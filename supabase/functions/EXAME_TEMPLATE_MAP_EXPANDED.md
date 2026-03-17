# Mapeamento Expandido de Templates de Exames

## Baseado em Compêndios Médicos Brasileiros

### Referências
- **CFM (Conselho Federal de Medicina)**: Resoluções 2299/2021, 2381/2024
- **ANVISA (Agência Nacional de Vigilância Sanitária)**: Diretrizes e regulamentações
- **SBPC/ML (Sociedade Brasileira de Patologia Clínica/Medicina Laboratorial)**: Diretrizes
- **SBC (Sociedade Brasileira de Cardiologia)**: Diretrizes
- **SBD (Sociedade Brasileira de Diabetes)**: Diretrizes
- **SBN (Sociedade Brasileira de Nefrologia)**: Diretrizes
- **SBEM (Sociedade Brasileira de Endocrinologia)**: Diretrizes
- **SBH (Sociedade Brasileira de Hepatologia)**: Diretrizes
- **CBR (Colégio Brasileiro de Radiologia)**: Diretrizes

## Lista Completa de Exames Mapeados

### Hematologia (40+ variações)
- Hemograma completo, CBC, hemograma com plaquetas
- Coagulograma, plaquetas, reticulócitos
- VHS, PCR, ferritina, ferro sérico, transferrina
- Vitamina B12, ácido fólico, folato

### Glicemia e Metabolismo (15+ variações)
- Glicemia, glicemia em jejum, pós-prandial
- HbA1c, hemoglobina glicada/glicosilada
- Curva glicêmica, TTG, insulina, peptídeo C

### Lipídios (10+ variações)
- Colesterol total, HDL, LDL, VLDL
- Perfil lipídico, lipidograma
- Triglicerídeos

### Função Hepática (20+ variações)
- TGO/AST, TGP/ALT, GGT, fosfatase alcalina
- Bilirrubina total, direta, indireta
- Albumina, proteínas totais, TP, INR

### Função Renal (15+ variações)
- Creatinina, ureia, BUN
- Depuração/clearance de creatinina
- Ácido úrico, microalbuminúria, proteinúria

### Eletrólitos (10+ variações)
- Sódio (Na), Potássio (K), Cloro (Cl)
- Magnésio (Mg), Fósforo (P), Cálcio (Ca)

### Função Tireoidiana (15+ variações)
- TSH, T4 livre, T3 livre, T4 total, T3 total
- Perfil tireoidiano, anti-TPO, anti-TG

### Vitaminas e Minerais (10+ variações)
- Vitamina D, Vitamina B12, Ácido fólico
- Zinco, Selênio

### Marcadores Tumorais (10+ variações)
- PSA, CEA, CA 125, CA 19-9, CA 15-3, AFP
- B2 microglobulina

### Pâncreas (5+ variações)
- Amilase, Lipase, Elastase fecal/pancreática

### Coração e Marcadores Cardíacos (10+ variações)
- BNP, NT-proBNP, Troponina I/T
- CK-MB, CK, CPK, LDH

### Hormônios e Fertilidade (15+ variações)
- Testosterona, LH, FSH, Prolactina
- Estradiol, Progesterona, Cortisol, ACTH
- Aldosterona, Renina

### Ultrassonografia (20+ variações)
- Ultrassonografia geral, abdominal, pélvica
- Transvaginal, de próstata, obstétrica
- Doppler vascular, carotídeo

### Radiologia (5+ variações)
- Raio-X, Radiografia, RX tórax

### Tomografia (10+ variações)
- TC/CT Scan, TC crânio, TC tórax
- TC abdômen, TC pelve

### Ressonância Magnética (10+ variações)
- RM/MRI, RM crânio, RM coluna, RM joelho

### Mamografia (4+ variações)
- Mamografia bilateral, de rastreamento, diagnóstica

### Cardiologia (15+ variações)
- ECG/Eletrocardiograma
- Teste ergométrico, teste de esforço, ergometria
- Holter 24h, MAPA 24h
- Ecocardiograma transtorácico/transesofágico

### Endoscopia (8+ variações)
- Endoscopia digestiva alta (EDA)
- Com/sem biópsia
- Colonoscopia, Retossigmoidoscopia

### Ginecologia (10+ variações)
- Papanicolau, Preventivo, Citologia oncótica
- Colposcopia, Histeroscopia, Vulvoscopia

### Urologia (8+ variações)
- Urocultura, EAS, Urinálise
- Ultrassonografia renal/vesical

### Infectologia e Sorologia (20+ variações)
- HIV, Hepatites A/B/C
- VDRL/RPR (Sífilis), Toxoplasmose
- Rubéola, CMV, Mononucleose (EBV)

### Alergia e Imunologia (5+ variações)
- IgE total/específica, Painel de alérgenos

### Outros Exames Comuns (5+ variações)
- Parasitológico de fezes, Coprocultura
- Densitometria óssea (DXA)

## Total: 280+ variações de exames mapeados

## Templates Necessários no Bucket

### Templates Específicos
1. `hemograma_completo.pdf`
2. `glicemia.pdf`
3. `glicemia_jejum.pdf`
4. `colesterol_total.pdf`
5. `triglicerideos.pdf`
6. `tgo_tgp.pdf`
7. `funcao_renal.pdf`
8. `eletrolitos.pdf`
9. `tsh_t4.pdf`
10. `vitamina_d.pdf`
11. `ferritina.pdf`
12. `acido_urico.pdf`
13. `psa.pdf`
14. `amilase_lipase.pdf`
15. `bnp.pdf`
16. `ultrassonografia.pdf`
17. `ultrassonografia_abdomen.pdf`
18. `raio_x.pdf`
19. `tomografia.pdf`
20. `tomografia_abdomen.pdf`
21. `ressonancia_magnetica.pdf`
22. `mamografia.pdf`
23. `eletrocardiograma.pdf`
24. `teste_ergometrico.pdf`
25. `holter.pdf`
26. `mapa.pdf`
27. `endoscopia.pdf`
28. `colonoscopia.pdf`
29. `ecocardiograma.pdf`
30. `papanicolau.pdf`

### Template Genérico (Fallback Obrigatório)
- `exame_generico.pdf` - **DEVE EXISTIR SEMPRE**

## Estrutura Recomendada

```
Bucket: guias-exames-templates
├── exame_generico.pdf (OBRIGATÓRIO)
├── hemograma_completo.pdf
├── glicemia.pdf
├── glicemia_jejum.pdf
├── colesterol_total.pdf
├── triglicerideos.pdf
├── tgo_tgp.pdf
├── funcao_renal.pdf
├── eletrolitos.pdf
├── tsh_t4.pdf
├── vitamina_d.pdf
├── ferritina.pdf
├── acido_urico.pdf
├── psa.pdf
├── amilase_lipase.pdf
├── bnp.pdf
├── ultrassonografia.pdf
├── ultrassonografia_abdomen.pdf
├── raio_x.pdf
├── tomografia.pdf
├── tomografia_abdomen.pdf
├── ressonancia_magnetica.pdf
├── mamografia.pdf
├── eletrocardiograma.pdf
├── teste_ergometrico.pdf
├── holter.pdf
├── mapa.pdf
├── endoscopia.pdf
├── colonoscopia.pdf
├── ecocardiograma.pdf
└── papanicolau.pdf
```
