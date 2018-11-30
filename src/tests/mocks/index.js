import setupClient from "apollo-client-mock";
import typeDefs from "./_schema";
import fixtures from "../fixtures";

const defaultMocks = {
  Query: () => ({
    storiesCount: (_, args) => 1, // eslint-disable-line
    stories: (_, args) => {
      const { stories } = fixtures;
      const { where: operators = {} } = args;
      let result = stories;
      if (operators) {
        const { published, flagged } = operators;
        result = stories.filter(s => {
          if (published && s.published) {
            return true;
          }
          if (!published && !flagged && !s.published && !s.flagged) {
            return true;
          }
          if (!published && flagged && !s.published && s.flagged) {
            return true;
          }
          return false;
        });
      }
      return result;
    }
  }),
  /* eslint-disable no-underscore-dangle */
  Mutation: () => ({
    setStoryStatus: (_, { _id, published, flagged }) => {
      const { stories } = fixtures;
      const story =
        stories.filter(s => s._id === _id).length > 0
          ? stories.filter(s => s._id === _id)[0]
          : null;
      if (!story) {
        return null;
      }
      return {
        ...story,
        published,
        flagged
      };
    }
  })
};

const createClient = setupClient(defaultMocks, typeDefs);

export default createClient;