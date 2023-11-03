# Three Query types with examples:
1. loadParents
* proteinID => all parent levels
* doesn't call db
* returns all parents

2. loadOrthologs
* proteinID, taxonLevel => all orthologs
* MATCH (n1:Protein {eid:$proteinID}) - [r:{level:$taxonLevel}] -> (n2: NOG) <--(n3:Protein) return n3
* All "n3"s are listed as members with dataset info and abundance

3. loadTissues
* proteinID, taxonLevel => tissues
* MATCH (n1:Protein {eid:$proteinID}) - [r:{level:$taxonLevel}] -> (n2: NOG) <--(n3:Protein)-->(n4: dataset) return DISTINCT n4.organ as tissues
* tissues as output2

4. loadAbundances
* proteinID, taxonLevel, tissue => all abundance info
* MATCH (n1:Protein {eid:$proteinID}) - [r:{level:$taxonLevel}] -> (n2: NOG) <--(n3:Protein)-->(n4: dataset) WHERE n4.organ = $tissue return n4

