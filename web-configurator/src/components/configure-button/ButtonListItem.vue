<script setup lang="ts">
import { computed, useTemplateRef } from "vue";
import { asyncComputed } from "@vueuse/core";

import type { ButtonMappingPressType } from "@/types/enums";
import type { EntityCommand } from "@/types/activity";

interface PressList {
  short_press: any;
  // double_press: any;
  long_press: any;
  [key: string]: any; // Index signature to allow any string key
}

import translatedProperty from "@/composables/translatedProperty";
import { useWindowDimension } from "@/composables/windowDimension";
import { getNewIconName } from "@/composables/icon";

import ButtonPress from "@/components/configure-button/ButtonPress.vue";
import AppDialog from "@/components/elements/AppDialog.vue";

const { isSmallScreen } = useWindowDimension();

const emit = defineEmits(["editPressType", "reset"]);

const props = defineProps({
  button: {
    type: Object,
    required: true,
  },
  selected: {
    type: Object,
    default: null,
  },
  entity: {
    type: Object,
    required: true,
  },
  expanded: {
    type: Boolean,
    default: false,
  },
  danglingEntities: {
    type: Array,
    default: () => [],
  },
});

const dialogConfirmReset =
  useTemplateRef<InstanceType<typeof AppDialog>>("dialogConfirmReset");

const pressList = computed<PressList>(() => {
  return {
    short_press:
      props.selected != null && props.selected?.short_press
        ? props.selected.short_press
        : null,
    // double_press: props.selected != null && props.selected?.double_press ? props.selected.double_press : null,
    long_press:
      props.selected != null && props.selected?.long_press
        ? props.selected.long_press
        : null,
  };
});

const buttonIconClasses = asyncComputed(async () => {
  const classes = ["icon"];
  if (props.button.icon) {
    const iconName = props.button.icon.split("uc:")[1];
    const newIconName = await getNewIconName(iconName);

    let buttonIcon = props.button.icon.replace(/^uc:/, "fa-");

    if (
      iconName &&
      iconName.length > 0 &&
      newIconName &&
      newIconName.length > 0
    ) {
      buttonIcon = buttonIcon.replace(iconName, newIconName);
    }
    buttonIcon = buttonIcon.replace("_", "-");

    classes.push(buttonIcon);

    if (
      props.button.button == "GREEN" ||
      props.button.button == "YELLOW" ||
      props.button.button == "RED" ||
      props.button.button == "BLUE"
    ) {
      classes.push(`icon-color--${props.button.button.toLowerCase()}`);
    }
  } else {
    classes.push("fa-question");
  }
  return classes;
});

function isDangling(command?: EntityCommand) {
  if (!command) return false;
  return props.danglingEntities.includes(command.entity_id);
}

function startResetButton() {
  dialogConfirmReset.value?.open();
}

function resetButton() {
  emit("reset");
}

function pressClick(pressType: ButtonMappingPressType, ev: MouseEvent) {
  if (isSmallScreen.value == true) {
    return false;
  }

  emit("editPressType", props.selected, pressType, ev);
}
</script>
<template>
  <div class="button-list__item">
    <div class="button-list__item__base">
      <span class="button-list__item__icon">
        <i class="fa-light" :class="buttonIconClasses"></i>
      </span>
      <span class="button-list__item__name">
        {{ translatedProperty(button.name) }}
      </span>
    </div>
    <div class="button-list__item__config">
      <Transition name="opacity-fast">
        <div
          v-show="expanded == false || isSmallScreen"
          class="button-list__item__config__compact"
        >
          <ButtonPress
            v-for="pressKey in Object.keys(pressList)"
            :key="`presstype-compact-${pressKey}-${button.button}`"
            :type="pressKey.split('_')[0]"
            :data="pressList[pressKey]"
            :dangling="isDangling(pressList[pressKey])"
            :mini="isSmallScreen"
            :button-id="button?.button ?? ''"
            @edit="(e) => pressClick(pressKey as ButtonMappingPressType, e)"
          />
          <button
            class="button button--blank button--icon button-reset"
            @click="startResetButton"
          >
            <i class="fa-regular fa-arrow-rotate-left"></i>
          </button>
        </div>
      </Transition>
      <Transition name="opacity-fast">
        <div
          v-show="expanded == true && !isSmallScreen"
          class="button-list__item__config__expanded"
        >
          <ButtonPress
            v-for="pressKey in Object.keys(pressList)"
            :key="`presstype-expanded-${pressKey}-${button.button}`"
            :type="pressKey.split('_')[0]"
            :expanded="expanded == true && !isSmallScreen"
            :data="pressList[pressKey]"
            :dangling="isDangling(pressList[pressKey])"
            :entity="entity"
            :button-id="button?.button ?? ''"
            @edit="(e) => pressClick(pressKey as ButtonMappingPressType, e)"
          />
        </div>
      </Transition>
    </div>
    <AppDialog
      ref="dialogConfirmReset"
      :title="$t('button_mapping.reset_more.title')"
      :text="$t('button_mapping.reset_more.question')"
      :submit-text="$t('ui.accept')"
      :cancel-text="$t('ui.cancel')"
      @submit="resetButton"
    />
  </div>
</template>
