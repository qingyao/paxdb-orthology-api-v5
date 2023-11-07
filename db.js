const fs = require('fs');
// const { type } = require('os');
// const path = require('path');
const _ = require('lodash');
const neo4j = require('neo4j-driver');

const ORTHOLOGY_SPECIES_MAP = 'data/ontology/ontology_2_species.tsv';
const ORTHOLOGY_LEVELS_MAP = 'data/ontology/cogs.txt';
const TAXONOMY_TREE = 'data/ontology/taxonomy_tree.tsv';
const ONTOLOGY_TERMS = 'data/ontology/ontology_terms.tsv';

const LEVEL_TYPE = { ORTHGROUP: 'orthgroup', SPECIES: 'species' };

class Neo4j_engine {
    constructor(retries, NEO4J_URL, NEO4J_USER, NEO4J_PASS) {
        this.driver = this.createDriver(retries, NEO4J_URL, NEO4J_USER, NEO4J_PASS);

        this.speciesTissueMap = this.loadSpeciesTissuesMap();
        this.orthgroups = this.loadOrthgroups();
        this.tissueOntology = this.loadOntology();
        this.orthgroups_set = new Set(Object.values(this.orthgroups));

        this.taxonomyMap = this.loadTaxonomyMap();
        this.levelAllChildren = this.loadAllChildren(this.taxonomyMap);
        this.speciesAllParent = this.loadSpeciesAllParents(this.taxonomyMap);
        
        /**
         * 
         * @returns {taxon_level_id: taxon_level_name}
         */
        this.taxonomicIDName = {}    
        for (let key of Object.keys(this.taxonomyMap)) {
            this.taxonomicIDName[key] = this.taxonomyMap[key].name
        }
            
        /**
         * 
         * @returns {taxon_level_name: taxon_level_id}
         */
        this.nameTaxonomicID = {}
        for (let key of Object.keys(this.taxonomyMap)) {
            this.nameTaxonomicID[this.taxonomyMap[key].name] = key
        }
         
        
    }

    isValidTaxonomicLevel(taxonomic_level){
        return this.orthgroups_set.has(taxonomic_level);
    }

    isValidTissue(tissue) {
        return tissue in this.tissueOntology;
    }

    createDriver(retries, NEO4J_URL, NEO4J_USER, NEO4J_PASS) {
        try {
            let driver = neo4j.driver(NEO4J_URL, neo4j.auth.basic(NEO4J_USER, NEO4J_PASS));
            driver.getServerInfo()
            .then((serverInfo)=> {
                console.log('Connection estabilished', serverInfo)
            })
            .catch((error) => {
                throw error;
            });
            return driver;
        } 
        catch (error) {
            if (error.code === 'ServiceUnavailable' && retries > 0 ) {
                setTimeout( () => {
                    driver.close();
                    // console.log(retries);
                    retries--;
                    createDriver(retries);
                }, 1000);
            } else {
                throw error;
            }
        }
    } 
    
    /**
     * 
     * @returns {tissue_id: tissue_name}
     */
    loadOntology() {
        let map = {};
        const filecontents = fs.readFileSync(ONTOLOGY_TERMS, {encoding: 'utf-8'})
        filecontents.split('\n').forEach((line) => {
            let rec = line.split('\t');
            if (rec.length >= 2) {
                map[rec[1]] = rec[0]
            }
        })
        return map;
    }

    /**
     * 
     * @returns {taxon_level_id: taxon_level_name}
     */
    loadOrthgroups() {
        let orthgroups = {}
        const filecontents = fs.readFileSync(ORTHOLOGY_LEVELS_MAP, { encoding: 'utf8' });
        filecontents.split('\n').forEach((line) =>{
            const rec = line.split(': ');
            if (rec.length < 2) {
                return;
            }
            let orth_id = parseInt(rec[0],10);
            orthgroups[orth_id] = rec[1].toUpperCase();
        });
        return orthgroups;
    }
    
    /**
     * 
     * @returns {species: [tissue]}
     */
    loadSpeciesTissuesMap() {
        let map = {};
        const filecontents = fs.readFileSync(ORTHOLOGY_SPECIES_MAP, { encoding: 'utf-8'});
        filecontents.split('\n').forEach((line) => {
            const rec = line.split('\t')
            if (rec.length < 2){
                return;
            } 
            if (!(rec[0] in map)) {
                map[rec[0]] = []
                
            } 
            map[rec[0]].push(rec[1])
        })
        return map;
    }
    
    /**
     * inner function used by loadTaxonomyMap
     * @param {*} nodes 
     * @param {*} parent 
     * @param {*} child 
     * @param {*} parentName 
     * @param {*} childName 
     * @returns 
     */
    _appendNode(nodes, parent, child, parentName, childName) {
        // update child
        if (!(child in nodes)){ 
            nodes[child] = {
                parent: parent,
                parentName: parentName,
                children: [],
                children_group: [],
                name: childName
            }
            if (child in this.orthgroups) {
                nodes[child].type =  LEVEL_TYPE.ORTHGROUP;
            } else {
                nodes[child].type = LEVEL_TYPE.SPECIES;
            }
        } else { // must have been added as parent
            nodes[child].parent = parent
            nodes[child].parentName = parentName
        }
        
        // update parent
        if (!(parent in nodes)) {
            nodes[parent] = {
                children: [],
                children_group: [],
                name: parentName
            }
            if (parent in this.orthgroups) {
                nodes[parent].type = LEVEL_TYPE.ORTHGROUP;
            } else {
                nodes[parent].type = LEVEL_TYPE.SPECIES;
            }
    
        } 
        if (child in this.orthgroups) {
            nodes[parent].children_group.push(child);
        } else {
            nodes[parent].children.push(child);
        }
        // console.log(nodes);
        return nodes;
    }
    
    /**
     * 
     * @param {*} nodes
     * @returns {species:[parent_taxon_level]}
     */
    loadSpeciesAllParents(nodes) {
        let sp_par = {}
        for (const node of Object.keys(nodes)) {
            if (node in nodes){
                if (nodes[node].type == LEVEL_TYPE.SPECIES) {
                    sp_par[node] = [];
                    let par = nodes[node].parent
                    while (par in nodes){
                        sp_par[node].push(par);
                        par = nodes[par].parent
                    }
                }
            } 
        }
        for (let sp in sp_par) {
            sp_par[sp].sort((a,b) => this.levelAllChildren[a].length - this.levelAllChildren[a].length );
        }
        return sp_par;
    }
    
    /**
     * 
     * @param {*} nodes 
     * @returns {taxon_level: [children_species]}
     */
    loadAllChildren(nodes) {
        let level_children = {};
        const nodes_copy = _.cloneDeep(nodes);
        function cleanupChildrenGroup(nodes, currNode) {
        
            let children_purged = [];
            if (nodes[currNode].children_group.length > 0) {
                for (let i=nodes[currNode].children_group.length -1; i>=0; i--) {
                    const curr_children_group = nodes[currNode].children_group[i]
                    children_purged.push(...cleanupChildrenGroup(nodes, curr_children_group)) 
                    }
                } 
            nodes[currNode].children.push(...children_purged);
            nodes[currNode].children_group.length = 0;
            children_purged = nodes[currNode].children;
    
            return children_purged;
        }
        cleanupChildrenGroup(nodes_copy, '1', [])
        // console.log(nodes_copy['1'].children.length);
        
        for (let node of Object.keys(nodes_copy)) {
            if (nodes_copy[node].type == LEVEL_TYPE.ORTHGROUP) {
                level_children[node] = nodes_copy[node].children.sort((a,b) => parseInt(a) - parseInt(b))
            }
        }
        return level_children;
    }
    
    /**
     * 
     * @returns {orth_id: {parent: str,
     *           children: [str],
     *           children_group: [str],
     *           name: str,
     *           type: LEVEL_TYPE}}
     */
    loadTaxonomyMap () {
        const filecontents = fs.readFileSync(TAXONOMY_TREE, {encoding: 'utf-8'});
        let nodes = {}
        let lines = filecontents.split('\n').slice(2);
        lines.forEach((line) => {
            const rec = line.split('\t');
            if (rec.length == 4){
                const parent = rec[1];
                const parentName = rec[3].toUpperCase();
                const child = rec[0];
                const childName = rec[2].toUpperCase();
                
                nodes = this._appendNode(nodes, parent, child, parentName, childName)
            }
        })
        return nodes;
    }
    
    loadParents (speciesID) {
        const taxon_level_names = this.speciesAllParent[speciesID].map((level) => {return {
            "id": level,
            "name": this.taxonomicIDName[level]}
        })
        return taxon_level_names;
    }
    
    async loadTissues(proteinID, taxonLevel) {
        const query = `MATCH (n1:NOG) <-- (n2: Protein {eid:"${proteinID}"})--> (n3:Dataset)
        where n1.level = $taxonLevel
        return DISTINCT n3.organ as tissues`
        const session = this.driver.session();
        const result = await session.run(query, {taxonLevel: taxonLevel});
        const tissues = result.records.map(record => record.get(0));
        await session.close();
        return tissues;
    }
    
    async loadOrthologs(proteinID, taxonLevel) {
        const query = `MATCH (n1:Protein {eid:$proteinID}) --> (n2: NOG) <--(n3:Protein)-->(n4:Dataset)
                    where n2.level=$taxonLevel return distinct n3`
        const session = this.driver.session();
        const result = await session.run(query,{
            proteinID: proteinID,
            taxonLevel: taxonLevel
        });
        const orthologs = result.records.map(record=> record.get(0));
        
        const members = orthologs.map(node => ({
            // stringdbInternalId: node.properties.iid,
            proteinId: node.properties.eid,
            name: node.properties.name,
        }));
        await session.close();
        return members;
    }
    
    async findLowestLevel(proteinID, currentLevelID, tissue) {
        // console.log(currentLevelID)
        // console.log(this.taxonomyMap[currentLevelID])
        const query = `MATCH (n1:Protein {eid:$proteinID}) --> (n2: NOG) <--(n3:Protein)-->(n4:Dataset) 
                        WHERE n4.organ = $tissue and n2.levelId = $level return distinct n3`
        const session = this.driver.session();
        let finished = false
        
        const testLevel = async () => {
            if ("parent" in this.taxonomyMap[currentLevelID]){
                currentLevelID = this.taxonomyMap[currentLevelID].parent;
            }
            else {
                finished = true;
                // console.log('finished', currentLevelID)
            }

            const result = await session.run(query, {
                proteinID: proteinID,
                tissue: tissue,
                level: parseInt(currentLevelID)
            });
            const orthologs = result.records.map(record => record.get(0));
            
            return orthologs;
        }

        let orthologs = await testLevel();
        while ( orthologs.length == 0 ) {
            if (!finished) {
                try {
                    orthologs = await testLevel()
                } catch (err) {
                    console.error(err)
                }
            } else {
                return 'NoLevelFound';
            }
        }
        await session.close();
        console.log(proteinID,currentLevelID)
        return this.taxonomicIDName[currentLevelID];
    }

    async loadAbundances(proteinID, tissue, taxonLevel) {
        const members = await this.loadOrthologs(proteinID, taxonLevel);
        const session = this.driver.session();
        let abundances = [];
        let orthologIds = members.map( member => String(member.proteinId) )
        orthologIds.push(proteinID);
        for (let protein_eid of orthologIds){
            // const protein_iid = member.stringdbInternalId;
            const protein_name = member.name;
            
            const query = `MATCH (n3:Protein {eid:$proteinID})-[r2]->(n4: Dataset) 
                        WHERE n4.organ = $tissue return r2,n4`
            // console.log(query)
            const result = await session.run(query, {
                proteinID: protein_eid, 
                tissue: tissue
            });
            // const members = []
            let chosen_dataset_idx = 0; //default first one if there's only one dataset
            if (result.records.length == 0) continue;
            
            if (result.records.length > 1){
                let integrated_idx = null;
                let max_score_idx = null;
                let max_score = 0;
                for (let i = 0; i < result.records.length; i++) {
                    // console.log(result.records[i].get(1).properties)
                    //dataset
                    if (result.records[i].get(1).properties.integrated) {
                        integrated_idx = i;
                        break
                    }
                    const this_score = result.records[i].get(1).properties.score;
                    
                    if (this_score > max_score) {
                        max_score_idx = i;
                        max_score = this_score
                    }
                }
                chosen_dataset_idx = (integrated_idx !== null) ? integrated_idx : max_score_idx    
                // console.log(chosen_dataset_idx, integrated_idx, max_score_idx)
            }
            const abundance = result.records[chosen_dataset_idx].get(0).properties;
            const dataset = result.records[chosen_dataset_idx].get(1).properties;

            abundances.push ({
                    // stringdbInternalId:protein_iid,
                    proteinId:protein_eid,
                    name:protein_name,
                    abundance:{
                        value:parseFloat(abundance.ppm),
                        position:parseInt(abundance.rank.substring(0,abundance.rank.indexOf('/')), 10),
                        rank:abundance.rank,
                    },
                    dataset: {
                        filename:dataset.filename,
                        iid: dataset.iid,
                    }})
        }
        await session.close();
        return abundances;
    }

    async loadAbundancesNew(proteinID, tissue, taxonLevel) {
        const members = await this.loadOrthologs(proteinID, taxonLevel);
        const session = this.driver.session();
        let abundances = [];
        let orthologIds = members.map( member => String(member.proteinId) )
        orthologIds.push(proteinID);
        const query = `MATCH (n3:Protein)-[r2]->(n4: Dataset) 
                        WHERE n4.organ = $tissue and n3.eid in $eids
                        return n3,r2,n4`
        // console.log(query)
        const result = await session.run(query, {
            eids: orthologIds, 
            tissue: tissue
        });

        if (result.records.length > 0) {

            const proteinId_records = {};
            result.records.forEach(rec => {
                const protein_node = rec.get(0)
                const protein_eid = protein_node.properties.eid;
                const protein_name = protein_node.properties.name;
                if (!(protein_eid in proteinId_records)) {
                    proteinId_records[protein_eid] = {'name':protein_name, 'records':[]}
                }
                proteinId_records[protein_eid].records.push({
                    'abundance': rec.get(1).properties,
                    'dataset': rec.get(2).properties
                })
            })
            // console.log(proteinId_records)
            for (let protein_eid of Object.keys(proteinId_records)){
                const records = proteinId_records[protein_eid]['records'];
                const protein_name = proteinId_records[protein_eid]['name'];

                let chosen_dataset_idx = 0; //default first one if there's only one dataset
                if (records.length == 0) continue;
                
                if (records.length > 1){
                    let integrated_idx = null;
                    let max_score_idx = null;
                    let max_score = 0;
                    for (let i = 0; i < records.length; i++) {
                        if (records[i].dataset.integrated) {
                            integrated_idx = i;
                            break
                        }
                        const this_score = records[i].dataset.score;
                        
                        if (this_score > max_score) {
                            max_score_idx = i;
                            max_score = this_score
                        }
                    }
                    chosen_dataset_idx = (integrated_idx !== null) ? integrated_idx : max_score_idx    
                    // console.log(chosen_dataset_idx, integrated_idx, max_score_idx)
                }
                const abundance = records[chosen_dataset_idx].abundance;
                const dataset = records[chosen_dataset_idx].dataset;
    
                abundances.push ({
                        // stringdbInternalId:protein_iid,
                        proteinId:protein_eid,
                        name:protein_name,
                        abundance:{
                            value:parseFloat(abundance.ppm),
                            position:parseInt(abundance.rank.substring(0,abundance.rank.indexOf('/')), 10),
                            rank:abundance.rank,
                        },
                        dataset: {
                            filename:dataset.filename,
                            iid: dataset.iid,
                        }})
            }
        }
        await session.close();
        return abundances;
    }

    /**
     * 
     * @param proteins [proteinId]  
     * @param taxonomicLevel string: name or id
     * @returns 
     */
    loadProteinFamilyTree(proteins, taxonomicLevel) {
        //typeof Array returns "object", same as all other non-primitive types
        if (!Array.isArray(proteins) || proteins.length === 0) { 
            return {};
        }
        // console.log('proteinFamilyTree');
        let species_protein = {}
        for (let i=0; i < proteins.length; i++) {
            let species = String(proteins[i]).split('.')[0]; // after database update, eid should be string type
            if (!(species in species_protein)) {
                species_protein[species] = []
            }
            species_protein[species].push(proteins[i])
        }
        // console.log(species_protein);
        const appendNodeToTree = (data, current_node) => {
            // console.log(data, current_node);
            const children_kept = data.children.filter(el => el in species_protein)
            // console.log(data)
            // console.log('children_kept',children_kept);
            
            current_node.children = []
            for (let i = 0; i < children_kept.length; i++) {
                const species_id = children_kept[i]
                current_node.children.push({'id':species_id, 
                    'type': 'species', 
                    'name': this.taxonomicIDName[species_id],
                    'proteins': species_protein[species_id].map((protein) => {return {'id':protein}})
                })
            }

            data.children_group.forEach((group_id) => {
                let new_node = {'id': group_id, 'type':'orthgroup', 'name': this.taxonomicIDName[group_id]}
                current_node.children.push(new_node)
                new_node = appendNodeToTree(this.taxonomyMap[group_id], new_node)
            })

            return current_node;
        }

        const data = this.taxonomyMap[this.nameTaxonomicID[taxonomicLevel]]
        // console.log(data);
        let proteinFamilyTree = appendNodeToTree(data, 
            {'id': this.nameTaxonomicID[taxonomicLevel], 'type': data.type, 'name': data.name})
        
        // console.log(JSON.stringify(proteinFamilyTree, null, 2));
        function cleanupEmptyGroup (parent_node, current_node, current_idx) {
            if (current_node.children && current_node.children.length > 0) {
                for (let i = current_node.children.length-1; i>=0; i--){
                    cleanupEmptyGroup(current_node, current_node.children[i], i);
                }
            }
            if (current_node.children && current_node.children.length == 0) {
                parent_node.children.splice(current_idx,1);
            }
        }
        cleanupEmptyGroup(proteinFamilyTree, proteinFamilyTree, 0);
        // console.log(JSON.stringify(proteinFamilyTree, null, 2));
        return proteinFamilyTree;
    }
    
}

module.exports = (NEO4J_URL, NEO4J_USER, NEO4J_PASS) => {
    const MaxRetries = 3;
    
    const backend = new Neo4j_engine(MaxRetries, NEO4J_URL, NEO4J_USER, NEO4J_PASS)

    // let test_label = "Load protein family tree";
    // console.time(test_label);
    // backend.loadProteinFamilyTree(['9598.ENSPTRP00000007822','10116.ENSRNOP00000041341'],'METAZOA')
    // console.timeEnd(test_label)

    // let test_label1 = "load abundances on luca level";
    // console.time(test_label1);
    // backend.loadAbundances('7227.FBpp0289675','WHOLE_ORGANISM','LUCA')//cdk2
    //     .then((res) => {console.log(res.length);console.timeEnd(test_label1)})//console.log('old',res.length, res[0]); 
    
    // let test_label2 = "new: load abundances on luca level";
    // console.time(test_label2);
    // backend.loadAbundancesNew('7227.FBpp0289675','WHOLE_ORGANISM','LUCA') //8030.ENSSSAP00000048102
    //     .then((res) => {console.log(res.length);console.timeEnd(test_label2)})//console.log('new',res.length, res[0]);
        

    let test_label3 = "find lowest level"
    console.time(test_label3);
    const eid = '9598.ENSPTRP00000007822';
    backend.findLowestLevel(eid, eid.split('.')[0], 'WHOLE_ORGANISM')
        .then(() => {console.timeEnd(test_label3)})
        .catch((err) => console.error(err))

    return backend
}
