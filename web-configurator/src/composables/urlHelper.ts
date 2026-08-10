export function useUrlHelper() {
  function addParams(
    paramObj: Record<string, unknown>,
    url: string,
    encode = false,
  ) {
    const dateTimeRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
    const params = [];

    for (const key in paramObj) {
      if (Object.prototype.hasOwnProperty.call(paramObj, key)) {
        let paramValue = String(paramObj[key]);

        // Check: format is date-time
        if (encode === true && dateTimeRegex.test(paramValue) === false) {
          paramValue = encodeURIComponent(paramValue);
        }

        params.push(`${key}=${paramValue}`);
      }
    }

    const paramString = params.join("&");
    const updatedUrl = url.split("?")[0] + "?" + paramString;

    return updatedUrl;
  }

  return {
    addParams,
  };
}
