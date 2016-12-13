/* eslint dot-notation: 0 */
'use strict';
var forEach = require('foreach');
var mongoose = require('mongoose');
var Schema = mongoose.Schema;

var MONGOOSE_SPECIFIC = 'x-swaggering-mongoose';
var ALLOWED_TYPES = {
  'integer': Number,
  'long': Number,
  'float': Number,
  'double': Number,
  'password': String,
  'boolean': Boolean,
  'date': Date,
  'dateTime': Date,
  // special case
  'string': true,
  'number': true,
  'array': true,
  'object': true
};

// object mixin
var extend = function( destination, source ) {
  for ( var k in source ) {
    if ( source.hasOwnProperty( k ) ) {
      destination[ k ] = source[ k ];
    }
  }
  return destination;
};

var convertToJSON = function(spec) {
  var swaggerJSON = {};
  var type = typeof (spec);
  switch (type) {
    case 'object':
      if (spec instanceof Buffer) {
        swaggerJSON = JSON.parse(spec);
      } else {
        swaggerJSON = spec;
      }
      break;
    case 'string':
      swaggerJSON = JSON.parse(spec);
      break;
    default:
      throw new Error('Unknown or invalid spec object');
  }
  return swaggerJSON;
};

var isSimpleSchema = function(schema) {
  return schema.type && !!ALLOWED_TYPES[schema.type];
};

var hasPropertyRef = function(property) {
  return property['$ref'] || ((property['type'] === 'array') && (property['items']['$ref']));
};

var fillRequired = function(object, key, template) {
  if (template.indexOf(key) >= 0 ) {
    if (object[key].type) {
      object[key].required = true;
    }
  }
};

var isMongooseProperty = function(property) {
  return !!property[MONGOOSE_SPECIFIC];
};

var isMongooseArray = function(property) {
  return property.items && property.items[MONGOOSE_SPECIFIC];
};

var getMongooseSpecific = function(props, property) {
  var mongooseSpecific = property[MONGOOSE_SPECIFIC];
  var ref = property.$ref;

  if (!mongooseSpecific && isMongooseArray(property)) {
    mongooseSpecific = property.items[MONGOOSE_SPECIFIC];
    ref = property.items.$ref;
  }

  if (!mongooseSpecific) {
    return props;
  }

  if (mongooseSpecific.type === 'ObjectId' && !mongooseSpecific.ref && ref) {
    mongooseSpecific.type = Schema.Types.ObjectId;
    mongooseSpecific.ref = ref.replace('#/definitions/', '');
  } else if ( mongooseSpecific.type ) {
    if (mongooseSpecific.type === Schema.Types.ObjectId) {
      return mongooseSpecific;
    }
    if (!Schema.Types[mongooseSpecific.type]) {
      throw new Error('Unrecognised ' + MONGOOSE_SPECIFIC + ' type: ' + mongooseSpecific.type + ' at: ' + JSON.stringify(property) );
    }
    mongooseSpecific.type = Schema.Types[mongooseSpecific.type];
  }
  return mongooseSpecific;
};

var isMongodbReserved = function(fieldKey) {
  return fieldKey === '_id' || fieldKey === '__v';
};

var getSchema = function(fullObject, objectName, definitions) {
  var props = {};
  var required = fullObject.required || [];
  var object = fullObject['properties'] ? fullObject['properties'] : fullObject;

  var propertyMap = function(property) {
    var type = ALLOWED_TYPES[property.type];
    if (!!type && type !== true) {
      return type;
    }
    switch (property.type) {
      case 'number':
        switch (property.format) {
          case 'integer':
          case 'long':
          case 'float':
          case 'double':
            return Number;
          default:
            throw new Error('Unrecognised schema format: ' + property.format);
        }
      case 'string':
        if (property.format === 'date-time' || property.format === 'date') {
          return Date;
        }
        return String;
      case 'array':
        return [propertyMap(property.items)];
      case 'object':
        return getSchema(property);
      default:
        throw new Error('Unrecognised property type: ' + property.type + ' at: ' + JSON.stringify(property));
    }
  };

  var processRef = function(property, key) {
    var refRegExp = /^#\/definitions\/(\w*)$/;
    var refString = property['$ref'] ? property['$ref'] : property['items']['$ref'];
    var refDefinition = refString.match(refRegExp);
    if (!refDefinition) {
      throw new Error('Unrecognised reference "' + refString + '" at: ' + JSON.stringify(property));
    }
    var propType = refDefinition[1];
	// console.log('processRef: objectName = ' + objectName + ', propType = ' + propType);
	schemaTree[objectName].child = propType;
	// console.log('processRef: objectName schemaTree[' + objectName + '] = ' + JSON.stringify(schemaTree[objectName], null, 2));

	if(schemaTree[propType] === undefined) {
		// console.log('no schemaTree for propType so create one')
		var node = {};
		node.parent = propType;
		node.child = '';
		node.childCount = 0;
		schemaTree[propType] = node;
	};

	schemaTree[propType].childCount++;

	var isCircularRef = (objectName === propType);
	var isCyclicRef = (schemaTree[propType].childCount > 0) && (schemaTree[objectName].child === schemaTree[propType].parent) && (schemaTree[propType].child === schemaTree[objectName].parent) && (schemaTree[objectName].child != schemaTree[propType].child) && (objectName != propType);

	// console.log('processRef: propType schemaTree[' + propType + '] = ' + JSON.stringify(schemaTree[propType], null, 2));
	// console.log('isCircularRef = ' + isCircularRef);
	// console.log('isCyclicRef = ' + isCyclicRef);

	const isObjectType = (property.type === undefined || property.type === 'object');

    if (isCircularRef || isCyclicRef) {
      // circular (objectName to self) or cyclic (objectName to propType to objectName) reference
	  if (isObjectType) {
		props[key] = {
			type: 'object',
			ref: propType
		}		  
	  } else {
		props[key] = {
			type: Schema.Types.ObjectId,
			ref: objectName
		};
	  }
	} else {
	// NOT circular or cyclic reference
	  if (isObjectType)
		props[key] = getSchema(definitions[propType]['properties'] ? definitions[propType]['properties'] : definitions[propType], propType, definitions);
	  else
		props[key] = [getSchema(definitions[propType]['properties'] ? definitions[propType]['properties'] : definitions[propType], propType, definitions)];
    };

	// console.log('  ProcessRefProperties: props[key] = \n' + key + JSON.stringify(props[key], null, 2) + '\n');
  };
  
  forEach(object, function(property, key) {
    if (isMongodbReserved(key) === true) {
      return;
    }

    try {
      if (isMongooseArray(property)) {
        props[key] = [getMongooseSpecific(props, property)];
      } else if (hasPropertyRef(property)) {
		  // console.log('forEach: processRef with key = ' + key + ', property = ' + JSON.stringify(property, null, 2));

        processRef(property, key);
      } else if (property.type) {
        if (property.type !== 'object') {
          props[key] = {
            type: propertyMap(property)
          };
        } else {
          props[key] = getSchema(property, key, definitions);
        }
      } else if (isSimpleSchema(object)) {
        props = {
          type: propertyMap(object)
        };
      }

      fillRequired(props, key, required);

      if (isMongooseProperty(property)) {
        props[key] = extend( props[key] || {}, getMongooseSpecific(props, property));
      }
    } catch (ex) {
      throw new Error('Exception processing key "' + key + '" at: ' + JSON.stringify(property) + ':\n' + ex.stack + '\n');
    }

  });

  return props;
};

var m = {};
var schemaTree = [];

m.getDefinitions = function(spec) {
  if (!spec) {
    throw new Error('Swagger spec not supplied');
  }
  var swaggerJSON = convertToJSON(spec);
  return swaggerJSON['definitions'];
};

m.getSchemas = function(definitions) {
  if (!definitions) {
    throw new Error('Definitions not supplied');
  }
  var schemas = {};
  forEach(definitions, function(definition, key) {
	// console.log('\n\n FOR EACH DEFINITION m.getSchemas().forEach().getSchema() for key = ' + key);
	
	var schemaTreeLength = Object.keys(schemaTree).length;
	// console.log('Current schemaTree length = ' + schemaTreeLength);
	
	var i;
	for (i = schemaTreeLength - 1; i > -1; i--) {
		// console.log('Delete schemaTree[i = ' + i + ' for ' + Object.keys(schemaTree)[i] + '] ' + JSON.stringify(schemaTree[Object.keys(schemaTree)[i]], null, 2));
		delete schemaTree[Object.keys(schemaTree)[i]];
	};

	var node = {};
	node.parent = key;
	node.child = '';
	node.childCount = 0;
	schemaTree[key] = node;
	// console.log('New schemaTree length = ' + Object.keys(schemaTree).length);

/* 	for (i = 0; i < Object.keys(schemaTree).length; i++) {
		console.log('schemaTree[i = ' + i + ' for ' + Object.keys(schemaTree)[i] + '] ' + JSON.stringify(schemaTree[Object.keys(schemaTree)[i]] || {}, null, 2))
	}; */

    var object = getSchema(definition, key, definitions);
	// console.log('OBJECT for ' + key + ' =\n' + JSON.stringify(object, null, 2));
    schemas[key] = new mongoose.Schema(object);
  });
  return schemas;
};

m.getModels = function(schemas) {
  if (!schemas) {
    throw new Error('Schemas not supplied');
  }
  var models = {};
  forEach(schemas, function(schema, key) {
    models[key] = mongoose.model(key, schema);
  });
  return models;
};

m.compile = function(spec) {
  var definitions = m.getDefinitions(spec);
  var schemas = m.getSchemas(definitions);
  var models = m.getModels(schemas);

  return {
    schemas: schemas,
    models: models
  };
};

module.exports = m;
