const express = require('express');
const router = express.Router();
const STRINGDB_PROTEINID_RE = /(\d+)\..+/;

//middleware, before route handler .get()
//monitor or check
router.use((req, res, next) => {
    next()
})

router.get('/', (req,res) => {
    const types = req.accepts(['json','html']);
    if (types == 'html') {
        res.render('protein',  { 
            title: 'pax-db.org API::Orthologous groups',
            subtitle: 'Protein API router'
        })

    } else {
        res.send({protein: "homepage"})
    }
})

router.param('protein_id', (req, res, next, proteinId) => {
    if (!STRINGDB_PROTEINID_RE.test(proteinId)) {
        res.status(400);
        res.render('error', {
            message: `Invalid protein id: ${proteinId}, expecting: <species>.<identifier>`,
        });
        return;
    }
    req.proteinId = proteinId;
    req.speciesId = STRINGDB_PROTEINID_RE.exec(proteinId)[1];
    next();
});

router.param('taxonomic_level', (req, res, next, taxonomic_level) => {
    let taxonomicLevel = decodeURIComponent(taxonomic_level.toUpperCase());
    if (!req.app.get('db').isValidTaxonomicLevel(taxonomicLevel)) {
        res.status(400);
        res.render('error', {
            message: `Invalid taxonomic level: ${taxonomic_level}`,
        });
        return;
    }
    req.taxonomicLevel = taxonomicLevel;
    next();
});

router.param('tissue', (req, res, next, value) => {
    let tissue = value.toUpperCase();
    
    if (!req.app.get('db').isValidTissue(tissue)){
        res.status(400);
        res.render('error', {
            message: `Invalid tissue input: ${value}`,
        });
        return;
    }
    req.tissue = tissue;
    next();
})

router.get('/:protein_id/ortholog_groups/', (req, res) => {
    let taxonomy_level_names;
    try {
        taxonomy_level_names = req.app.get('db').loadParents(req.speciesId);
        
    } catch (e) {
        res.status(400);
        res.render('error', {message: `failed to get ${req.proteinId}: ${e.message}`})
        return;
    }
    res.header('content-type', 'application/json');
    res.render('taxonlevels', {
        protein: req.proteinId, 
        taxonomy_level_names: taxonomy_level_names
    })
}) 


router.get('/:protein_id/ortholog_groups/get_lowest_level/:tissue', (req, res) => {
    
    req.app.get('db').findLowestLevel(req.proteinId, req.speciesId, req.tissue)
    .then(
        (result) => {
            // console.log(results);
            res.header('content-type', 'text/plain');
            res.send(result)
        })
    .catch ((e) => {
        res.status(400);
        res.render('error', {message: `failed to get a response from ${req.proteinId} at ${req.taxonomic_level} level: ${e.message}`})
        return;
    })
})

router.get('/:protein_id/ortholog_groups/:taxonomic_level', (req, res) => {

    req.app.get('db').loadTissues(req.proteinId, req.taxonomicLevel).then((tissues) => {
        
        let onto_terms = tissues.map((tissue) => req.app.get('db').tissueOntology[tissue])
        req.app.get('db').loadOrthologs(req.proteinId, req.taxonomicLevel)
            .then((orthologs) => {
            res.header('content-type', 'application/json');
            res.render('tissue_orthologs', {
                proteinId: req.proteinId,
                taxonomicLevel: req.taxonomicLevel,
                tissues: tissues, 
                onto_terms: onto_terms,
                orthologs: orthologs
                })
            })
            .catch ((e) => {
                res.status(400);
                res.render('error', {message: `failed to get a response from ${req.proteinId} and ${req.taxonomic_level}: ${e.message}`})
                return;
            })
    
    })
    .catch ((e)  => {
        res.status(400);
        res.render('error', {message: `failed to get a response from ${req.proteinId} and ${req.taxonomic_level}: ${e.message}`})
        return;
    })
    
}) 

router.get('/:protein_id/ortholog_groups/:taxonomic_level/list_tissues', (req, res) => {

    req.app.get('db').loadTissues(req.proteinId, req.taxonomicLevel).then((tissues) => {
        
        let onto_terms = tissues.map((tissue) => req.app.get('db').tissueOntology[tissue])
        res.header('content-type', 'application/json');
        res.render('tissue_orthologs', {
            proteinId: req.proteinId,
            taxonomicLevel: req.taxonomicLevel,
            tissues: tissues, 
            onto_terms: onto_terms,
    })
    
    })
    .catch ((e)  => {
        res.status(400);
        res.render('error', {message: `failed to get a response from ${req.proteinId} and ${req.taxonomic_level}`})
        return;
    })
    
}) 

router.get('/:protein_id/ortholog_groups/:taxonomic_level/list_orthologs', (req, res) => {

    req.app.get('db').loadOrthologs(req.proteinId, req.taxonomicLevel)
    .then((orthologs) => {
        
        res.header('content-type', 'application/json');
        res.render('tissue_orthologs', {
            proteinId: req.proteinId,
            taxonomicLevel: req.taxonomicLevel,
            orthologs: orthologs,
        })
    })
    .catch(() => {
        res.status(400);
        console.log()
        res.render('error', {message: `failed to get a response from ${req.proteinId} and ${req.taxonomicLevel}`})
    return;
    });
    
}) 


router.get('/:protein_id/ortholog_groups/:taxonomic_level/:tissue', (req, res) => {

    req.app.get('db').loadAbundancesNew(req.proteinId, req.tissue, req.taxonomicLevel)
    .then(
        (results) => {
            const familytree = req.app.get('db').loadProteinFamilyTree(results.map(result => result.proteinId), req.taxonomicLevel);
            // console.log(results);
            res.header('content-type', 'application/json');
            res.render('abundances', {
                speciesId: req.speciesId,
                proteinId: req.proteinId, 
                tissue: req.tissue,
                taxonomicLevel: req.taxonomicLevel,
                results: results,
                tree: familytree,
            })
        })
    .catch ((e) => {
        res.status(400);
        res.render('error', {message: `failed to get a response from ${req.proteinId} at ${req.taxonomicLevel} level in ${req.tissue}: ${e}`})
        return;
    })
})

router.get('/:protein_id/ortholog_groups2/:taxonomic_level/:tissue', (req, res) => {

    req.app.get('db').loadAbundancesNew(req.proteinId, req.tissue, req.taxonomicLevel)
    .then(
        (results) => {
            const familytree = req.app.get('db').loadProteinFamilyTree(results.map(result => result.proteinId), req.taxonomicLevel);
            // console.log(results);
            res.header('content-type', 'application/json');
            res.render('abundances', {
                speciesId: req.speciesId,
                proteinId: req.proteinId, 
                tissue: req.tissue,
                taxonomicLevel: req.taxonomicLevel,
                results: results,
                tree: familytree,
            })
        })
    .catch ((e) => {
        res.status(400);
        res.render('error', {message: `failed to get a response from ${req.proteinId} at ${req.taxonomicLevel} level in ${req.tissue}: ${e}`})
        return;
    })
})
module.exports = router;