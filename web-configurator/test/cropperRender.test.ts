// @vitest-environment jsdom
//
// Render-contract guard for vue-picture-cropper (1 consumer: ResourceUpload.vue).
//
// ResourceUpload mounts <VuePictureCropper ref="cropperRef" :img :options
// :box-style /> and drives cropping through the instance exposed on that ref
// (cropperRef.value.cropper -> getCroppedCanvas(), getImageData()), plus the
// cropperjs `options.ready` callback. vue-picture-cropper 1.0 removed the old
// module-level `cropper` singleton and the `@ready` Vue event, so this test
// pins the 1.0 contract the app now depends on: a default component export, a
// `useCropper` hook, acceptance of the app's img/options/box-style props, and
// a `cropper` property exposed on the mounted instance. A future major that
// renames these would fail here rather than silently break image cropping
// (the vue-draggable-next failure mode).
import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import VuePictureCropper, { useCropper } from "vue-picture-cropper";

const Host = defineComponent({
  components: { VuePictureCropper },
  render() {
    return h(VuePictureCropper, {
      ref: "cropperRef",
      boxStyle: { width: "100%", margin: "auto" },
      img: "data:image/png;base64,iVBORw0KGgo=",
      options: {
        dragMode: "crop",
        aspectRatio: 1,
        ready: () => {},
      },
    });
  },
});

describe("vue-picture-cropper render contract", () => {
  it("exports a default component and the useCropper hook", () => {
    expect(VuePictureCropper).toBeTruthy();
    expect(typeof useCropper).toBe("function");
  });

  it("mounts with the app's img/options/box-style props and renders the image", () => {
    // cropperjs touches canvas APIs jsdom doesn't implement; swallow those so
    // the mount/contract check is not derailed by the missing 2D context.
    vi.spyOn(console, "error").mockImplementation(() => {});
    const wrapper = mount(Host);
    // The <img> is the crop surface cropperjs binds to. Rendering it with the
    // app's exact props is the render-path proof; the exposed-`cropper` name
    // the app reads via its template ref is pinned by type-check.
    const img = wrapper.find("img");
    expect(img.exists()).toBe(true);
    expect(img.attributes("src")).toContain("data:image/png");
  });
});
