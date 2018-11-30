import handleElement from "./handle-element";

const allowedOperations = {
  type: ["ADD", "REMOVE", "MOVE"],
  row: ["TOP", "BOTTOM", "SORT"],
  add: undefined,
  remove: undefined
};

/**
 * This function updates apollo cache based on the configuration object.
 * @param {Object} configuration object
 * @returns {boolean} if operation did not throw errors.
 */
export default ({
  proxy,
  searchVariables,
  searchOperator = "AND",
  queriesToUpdate,
  mutationResult,
  operation = "ADD",
  ID = "id",
  switchVars
}) => {
  const errors = [];
  let operator = searchOperator;

  if (
    !!searchOperator &&
    typeof searchOperator === "string" &&
    !["AND", "OR"].includes(searchOperator)
  ) {
    console.warn(
      "ApolloCacheUpdater Warning: [AND | OR] are the only allowed search operators. Using AND as the default operator"
    );
    operator = "AND";
  } else if (!!searchOperator && typeof searchOperator !== "string") {
    console.warn(
      "ApolloCacheUpdater Warning: searchOperator should be a string. Using AND as the default operator"
    );
    operator = "AND";
  }

  let operationObj = {
    type: "ADD",
    row: {
      type: "TOP",
      field: undefined,
      ordering: undefined
    },
    add: undefined,
    remove: undefined
  };
  if (
    typeof operation === "string" &&
    allowedOperations.type.includes(operation)
  ) {
    operationObj.type = operation;
  } else if (
    typeof operation === "object" &&
    !Array.isArray(operation) &&
    operation !== null
  ) {
    let rowObj = {};
    if (
      operation.row &&
      typeof operation.row === "string" &&
      allowedOperations.row.includes(operation.row)
    ) {
      rowObj = {
        row: {
          type: operation.row,
          field: undefined,
          ordering: undefined
        }
      };
    } else if (
      operation.row &&
      typeof operation.row === "object" &&
      !Array.isArray(operation.row) &&
      operation.row !== null
    ) {
      rowObj = {
        row: {
          ...rowObj,
          ...operation.row
        }
      };
    } else if (operation.row && typeof operation.row === "string")
      errors.push(
        `${operation.row} is not valid. Use one of ${allowedOperations.row.join(
          ", "
        )}`
      );

    if (
      !!operation.add &&
      Object.prototype.toString.call(operation.add) !== "[object Function]"
    ) {
      errors.push(
        'You included a custom "add" field, but it is not a function. Only functions should be used in the "add" field'
      );
    }

    if (
      !!operation.remove &&
      Object.prototype.toString.call(operation.remove) !== "[object Function]"
    ) {
      errors.push(
        'You included a custom "remove" field, but it is not a function. Only functions should be used in the "remove" field'
      );
    }

    operationObj = {
      ...operationObj,
      ...operation,
      ...rowObj
    };
  } else if (typeof operation === "string")
    errors.push(
      `${operation} is not valid. Use one of ${allowedOperations.type.join(
        ", "
      )}`
    );
  const customAdd = operationObj.add;
  const customRemove = operationObj.remove;

  let searchKeys = [];

  if (!searchVariables) errors.push("searchVariables are required");
  if (
    !!searchVariables &&
    typeof searchVariables === "object" &&
    !Array.isArray(searchVariables) &&
    searchVariables !== null
  ) {
    const invalid =
      Object.entries(searchVariables).filter(
        entry =>
          typeof entry[1] !== "string" &&
          typeof entry[1] !== "number" &&
          typeof entry[1] !== "boolean"
      ).length > 0;
    if (invalid)
      errors.push(
        "searchVariables cannot have nested objects, or have null values or be a function, Use only number, string and boolean primitives"
      );
    searchKeys = Object.entries(searchVariables).map(entry =>
      JSON.stringify({ [entry[0]]: entry[1] })
    );
  } else errors.push("Invalid object as searchVariables");

  const queries = proxy.data.data.ROOT_QUERY;
  const apolloQueries = queriesToUpdate.map(query => {
    // extract the name of the query
    let queryName;
    const bodyString = JSON.stringify(query.loc.source.body)
      .replace(/\\n/g, "")
      .replace(/ /g, "");

    const re = /{(.*)}/;
    const m = bodyString.match(re);
    if (m[1].indexOf("(") > -1) {
      queryName = m[1].substr(0, m[1].indexOf("("));
    } else if (m[1].indexOf("@") > -1) {
      queryName = m[1].substr(0, m[1].indexOf("@"));
    } else if (m[1].indexOf("{") > -1) {
      queryName = m[1].substr(0, m[1].indexOf("{"));
    } else {
      queryName = m[1]; // eslint-disable-line prefer-destructuring
    }
    return {
      name: queryName,
      query
    };
  });

  // build the entries that match the search variables to be iterated later
  const targetQueries = apolloQueries.map(item => ({
    ...item,
    entries: Object.entries(queries)
      .filter(
        entry => entry[0].substring(0, item.name.length + 1) === `${item.name}(`
      )
      .reduce((arr, q) => {
        const k = q[0];
        const match =
          operator === "AND"
            ? searchKeys.filter(searchKey =>
                k.includes(searchKey.substr(1, searchKey.length - 2))
              ).length === searchKeys.length
            : searchKeys.filter(searchKey =>
                k.includes(searchKey.substr(1, searchKey.length - 2))
              ).length > 0;
        if (match) {
          const re = /{(.*)}/;
          const m = k.match(re);
          if (m != null)
            return [...arr, JSON.parse(`{${m[0].replace(re, "$1")}}`)];
          return [...arr];
        }
        return [...arr];
      }, [])
  }));
  if (!mutationResult || mutationResult === null)
    errors.push("mutationResult is required");
  if (
    mutationResult &&
    typeof mutationResult === "object" &&
    !Array.isArray(mutationResult) &&
    mutationResult !== null
  ) {
    if (!Object.prototype.hasOwnProperty.call(mutationResult, ID))
      errors.push(`mutationResult is an object but the field ${ID} is missing`);
  } else if (Array.isArray(mutationResult))
    errors.push("mutationResult cannot be an array");

  const invalid =
    switchVars &&
    Object.entries(switchVars).filter(
      entry =>
        typeof entry[1] !== "string" &&
        typeof entry[1] !== "number" &&
        typeof entry[1] !== "boolean"
    ).length > 0;
  if (invalid)
    errors.push(
      "switchVariables cannot have nested objects, or have null values or be a function, Use only number, string and boolean primitives"
    );

  if (errors.length === 0 && !!mutationResult) {
    targetQueries.forEach(element => {
      element.entries.forEach(variables => {
        const { query } = element;
        if (operationObj.type === "REMOVE" || operationObj.type === "ADD") {
          handleElement({
            proxy,
            query,
            mutationResult,
            variables,
            operation: operationObj.type,
            ID,
            element,
            customAdd,
            customRemove,
            insertion: operationObj.row.type,
            field: operationObj.row.field,
            ordering: operationObj.row.ordering,
            errors
          });
        }
        if (operationObj.type === "MOVE") {
          const elementToMove = handleElement({
            proxy,
            query,
            mutationResult,
            variables,
            operation: "REMOVE",
            ID,
            element,
            customRemove,
            errors
          });
          // add element only if target queries for the switch are in ROOT_QUERY
          const safeSwitchVars = switchVars || {};
          searchKeys = Object.entries(safeSwitchVars).map(entry =>
            JSON.stringify({ [entry[0]]: entry[1] })
          );
          const matches = Object.entries(queries).filter(entry => {
            const k = entry[0];
            const match =
              operator === "AND"
                ? searchKeys.filter(searchKey =>
                    k.includes(searchKey.substr(1, searchKey.length - 2))
                  ).length === searchKeys.length
                : searchKeys.filter(searchKey =>
                    k.includes(searchKey.substr(1, searchKey.length - 2))
                  ).length > 0;
            return match;
          });
          const processQuery = matches.length > 0;
          if (processQuery) {
            const re = /{(.*)}/;
            const m = matches[0][0].match(re);
            const queryVars = JSON.parse(m[0]);
            handleElement({
              proxy,
              query,
              mutationResult: elementToMove,
              variables: {
                ...queryVars
              },
              operation: "ADD",
              insertion: operationObj.row.type,
              field: operationObj.row.field,
              ordering: operationObj.row.ordering,
              ID,
              element,
              customAdd,
              errors
            });
          }
        }
        if (operationObj.type === "MOVE" && !switchVars)
          console.warn(
            "ApolloCacheUpdater Warning: MOVE operation requires switchVars but none was found. An empty object was used instead"
          );
      });
    });
  }
  if (errors.length > 0) {
    console.error(
      Array.from(new Set(errors.map(e => `ApolloCacheUpdater Error: ${e}`)))
    );
  }
  return errors.length === 0;
};
