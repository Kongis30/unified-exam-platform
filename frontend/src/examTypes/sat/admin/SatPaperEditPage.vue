<template>

    <div class="main-content">
      <RouterLink class="sat-editor-back" :to="returnLocation">← Back to Paper Management</RouterLink>
      <div class="header-section">
        <h1 class="page-title">Edit Paper: {{ paperTitle }}</h1>
        <p class="page-subtitle">Manage SAT sections, modules and questions for this paper</p>

      </div>

      <div class="paper-edit-container">
        <!-- 左侧二级菜单 -->
        <div class="modules-panel">
          <div class="panel-header">
            <h3>SAT Sections & Modules</h3>
            <div class="header-actions">
              <el-button 
                v-if="sortMode" 
                type="success" 
                size="small" 
                @click="saveSortOrder"
              >
                Save Order
              </el-button>
              <el-button 
                :type="sortMode ? 'warning' : 'info'" 
                size="small" 
                @click="toggleSortMode"
              >
                {{ sortMode ? 'Exit Sort' : 'Sort Mode' }}
              </el-button>
              <el-button type="primary" size="small" @click="addModule">Add Module</el-button>
            </div>
          </div>
          
          <div class="sections-list" v-loading="loading">
            <!-- 一级菜单：SAT阶段 -->
            <div 
              v-for="section in satSections" 
              :key="section.id" 
              class="section-group"
            >
              <div class="section-header" @click="toggleSection(section.id)">
                <div class="section-info">
                  <h4>{{ section.name }}</h4>
                  <span class="module-count">
                    {{ section.modules.length }} {{ section.modules.length === 1 ? 'module' : 'modules' }}
                  </span>
                </div>
                <el-icon class="expand-icon" :class="{ 'expanded': expandedSections.includes(section.id) }">
                  <ArrowDown />
                </el-icon>
              </div>
              
              <!-- 二级菜单：模块列表 -->
              <div v-if="expandedSections.includes(section.id)" class="modules-list">
                <div 
                  v-for="module in section.modules" 
                  :key="module.id" 
                  class="module-section"
                  :class="{ 'active': selectedModule?.id === module.id }"
                >
                  <!-- 普通模块或自适应模块主标题 -->
                  <div class="module-header" @click="toggleModule(module.id)">
                    <div class="module-info">
                      <h5>{{ module.name }}</h5>
                      <span class="question-count">
                        {{ module.isAdaptive 
                          ? `${module.adaptiveOptions?.length || 0} ${module.adaptiveOptions?.length === 1 ? 'module' : 'modules'}`
                          : `${(module.questions && module.questions.length) ? module.questions.length : 0} questions` }}
                      </span>
                    </div>
                    <el-icon 
                      v-if="module.isAdaptive || (module.questions && module.questions.length > 0)"
                      class="expand-icon" 
                      :class="{ 'expanded': expandedModules.includes(module.id) }"
                    >
                      <ArrowDown />
                    </el-icon>
                  </div>

                  <!-- 自适应模块的子选项 -->
                  <div v-if="module.isAdaptive && expandedModules.includes(module.id)" class="adaptive-options">
                    <div 
                      v-for="option in module.adaptiveOptions" 
                      :key="option.id"
                      class="adaptive-option"
                      :class="{ 'active': selectedModule?.id === option.id }"
                    >
                      <div class="adaptive-header" @click="toggleModule(option.id)">
                        <div class="adaptive-info">
                          <h6>{{ option.name }}</h6>
                          <span class="adaptive-desc">{{ option.description }}</span>
                          <span class="question-count">{{ option.questions?.length || 0 }} questions</span>
                        </div>
                        <el-icon 
                          v-if="option.questions && option.questions.length > 0"
                          class="expand-icon" 
                          :class="{ 'expanded': expandedModules.includes(option.id) }"
                        >
                          <ArrowDown />
                        </el-icon>
                      </div>

                      <!-- 自适应子模块的题目列表 -->
                      <div v-if="expandedModules.includes(option.id)" class="questions-list">
                        <draggable 
                          v-model="option.questions" 
                          :disabled="!sortMode"
                          v-bind="dragOptions"
                          @end="onQuestionMove($event, option)"
                          item-key="id"
                        >
                          <template #item="{ element: question, index }">
                             <div 
                               class="question-item"
                               :class="{ 
                                 'active': selectedQuestion?.id === question.id,
                                 'sortable': sortMode 
                               }"
                               role="button"
                               tabindex="0"
                               :aria-pressed="selectedQuestion?.id === question.id"
                               @click="!sortMode && selectQuestion(question, option)"
                               @keydown.enter.prevent="!sortMode && selectQuestion(question, option)"
                               @keydown.space.prevent="!sortMode && selectQuestion(question, option)"
                             >
                               <span class="drag-handle" aria-hidden="true">{{ sortMode ? '⋮⋮' : '' }}</span>
                               <span class="question-number">Q{{ index + 1 }}</span>
                               <span class="question-list-preview">{{ getQuestionPreview(question.content) || 'No question text' }}</span>
                               <span class="question-meta"><span v-for="tag in questionListTags(question)" :key="tag" class="question-meta-tag">{{ tag }}</span></span>
                             </div>
                           </template>
                        </draggable>
                        <div v-if="!sortMode" class="add-question-btn" @click="addQuestion(option)">
                          <el-icon><Plus /></el-icon>
                          Add Question
                        </div>
                      </div>
                    </div>
                  </div>

                  <!-- 普通模块的题目列表 -->
                  <div v-if="!module.isAdaptive && expandedModules.includes(module.id)" class="questions-list">
                    <draggable 
                      v-model="module.questions" 
                      :disabled="!sortMode"
                      v-bind="dragOptions"
                      @end="onQuestionMove($event, module)"
                      item-key="questionId"
                    >
                      <template #item="{ element: question, index }">
                         <div 
                           class="question-item"
                           :class="{ 
                             'active': selectedQuestion?.questionId === question.questionId,
                             'sortable': sortMode 
                           }"
                           role="button"
                           tabindex="0"
                           :aria-pressed="selectedQuestion?.questionId === question.questionId"
                           @click="!sortMode && selectQuestion(question, module)"
                           @keydown.enter.prevent="!sortMode && selectQuestion(question, module)"
                           @keydown.space.prevent="!sortMode && selectQuestion(question, module)"
                         >
                           <span class="drag-handle" aria-hidden="true">{{ sortMode ? '⋮⋮' : '' }}</span>
                           <span class="question-number">Q{{ index + 1 }}</span>
                           <span class="question-list-preview">{{ getQuestionPreview(question.content) || 'No question text' }}</span>
                           <span class="question-meta"><span v-for="tag in questionListTags(question)" :key="tag" class="question-meta-tag">{{ tag }}</span></span>
                         </div>
                       </template>
                    </draggable>
                    <div v-if="!sortMode" class="add-question-btn" @click="addQuestion(module)">
                      <el-icon><Plus /></el-icon>
                      Add Question
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 右侧题目编辑区域 -->
        <div class="question-panel">
          <div v-if="!selectedQuestion" class="no-selection">
            <el-empty description="Select a question to edit" />
          </div>
          
          <div v-else class="question-editor">
            <div class="editor-header">
              <h3>Question {{ getQuestionNumber(selectedQuestion) }}</h3>
              <div class="editor-actions">
                <el-button size="small" :disabled="stemImageUploading || materialImageUploading || optionImageUploading" @click="saveQuestion">Save</el-button>
                <el-button size="small" type="danger" @click="deleteQuestion">Delete</el-button>
              </div>
            </div>

            <div class="editor-content">
              <!-- 题目材料编辑区域 -->
              <div class="material-section">
                <div class="section-title">
                  <h4>Question Material</h4>
                  <div class="section-actions">
                    <el-upload
                      v-if="!showMaterialPreview"
                      class="material-upload"
                      :auto-upload="false"
                      :show-file-list="false"
                      :disabled="materialImageUploading"
                      accept="image/*"
                      :on-change="onMaterialImageChange"
                    >
                      <el-button size="small" :loading="materialImageUploading" :disabled="materialImageUploading">
                        Upload Image
                      </el-button>
                    </el-upload>
                    <el-switch
                      v-model="showMaterialPreview"
                      active-text="Preview"
                      inactive-text="Edit"
                      size="small"
                    />
                  </div>
                </div>
                <div class="material-tools" v-if="!showMaterialPreview">
                  <el-button v-if="materialImageUrl" size="small" type="danger" @click="onDeleteMaterialImage">Remove Image</el-button>
                  <span class="hint">Paste screenshots directly into the editor. Supported: png, jpg, jpeg, gif, webp</span>
                </div>

                <div v-if="showMaterialPreview" class="material-preview">
                  <div v-if="questionForm.material" class="passage-content sat-rich-text" v-math v-html="materialHtml"></div>
                  <div v-if="materialImageUrl" class="image-preview">
                    <el-image
                      :src="materialImageUrl"
                      :preview-src-list="[materialImageUrl]"
                      :zoom-rate="1.2"
                      :max-scale="3"
                      :min-scale="0.2"
                      fit="contain"
                      style="width: 100%; max-height: 220px; object-fit: contain;"
                    />
                  </div>
                  <div v-if="!questionForm.material && !materialImageUrl" class="no-material">No material content</div>
                </div>

                <div v-else>
                  <el-input
                    ref="materialContentInput"
                    v-model="questionForm.material"
                    type="textarea"
                    :rows="8"
                    placeholder="Enter question material. Use **text** for bold, ++text++ for underline, or paste an image."
                    class="material-editor"
                    @focus="saveMaterialCursor"
                    @click="saveMaterialCursor"
                    @keyup="saveMaterialCursor"
                    @select="saveMaterialCursor"
                    @paste="onMaterialPaste"
                  />
                  <div class="markdown-hint">
                    Formatting: <code>**bold**</code>, <code>++underline++</code>, and Markdown images.
                  </div>
                  <div v-if="materialImageUrl" class="image-preview">
                    <el-image
                      :src="materialImageUrl"
                      :preview-src-list="[materialImageUrl]"
                      fit="contain"
                      style="width: 100%; max-height: 220px; object-fit: contain;"
                    />
                  </div>
                </div>
              </div>

              <!-- 题目内容编辑区域 -->
              <div class="question-section">
                <div class="section-title">
                  <h4>Question Content</h4>
                  <div class="section-actions">
                    <el-upload
                      v-if="!showQuestionPreview"
                      class="stem-image-upload"
                      :auto-upload="false"
                      :show-file-list="false"
                      :disabled="stemImageUploading"
                      accept="image/*"
                      :on-change="onStemImageChange"
                    >
                      <el-button size="small" :loading="stemImageUploading" :disabled="stemImageUploading">
                        Upload Image
                      </el-button>
                    </el-upload>
                    <el-switch
                      v-model="showQuestionPreview"
                      active-text="Preview"
                      inactive-text="Edit"
                      size="small"
                    />
                  </div>
                </div>
                
                <div v-if="showQuestionPreview" class="question-preview">
                  <div class="question-text sat-rich-text" v-math v-html="questionHtml"></div>
                </div>
                
                <el-input 
                  v-else
                  ref="questionContentInput"
                  v-model="questionForm.content" 
                  type="textarea" 
                  :rows="4"
                  placeholder="Enter question content. Use **text** for bold, ++text++ for underline, or upload an image."
                  class="question-editor"
                  @focus="saveQuestionCursor"
                  @click="saveQuestionCursor"
                  @keyup="saveQuestionCursor"
                  @select="saveQuestionCursor"
                  @paste="onQuestionPaste"
                />
                <div v-if="!showQuestionPreview" class="markdown-hint">
                  Formatting: <code>**bold**</code>, <code>++underline++</code>, and Markdown images.
                </div>
              </div>

              <!-- 题目配置 -->
              <el-form :model="questionForm" label-position="top" class="question-form">
                <el-row :gutter="20">
                  <el-col :span="8">
                    <el-form-item label="Question Type">
                      <el-select v-model="questionForm.type" placeholder="Select type" @change="onQuestionTypeChange">
                        <el-option label="Multiple Choice" value="multiple_choice" />
                        <el-option label="Fill in Blank" value="fill_blank" />
                      </el-select>
                    </el-form-item>
                  </el-col>
                  <el-col :span="8">
                    <el-form-item label="Difficulty">
                      <el-select v-model="questionForm.difficulty" placeholder="Select difficulty">
                        <el-option label="Easy" value="easy" />
                        <el-option label="Medium" value="medium" />
                        <el-option label="Hard" value="hard" />
                      </el-select>
                    </el-form-item>
                  </el-col>
                  <el-col :span="8">
                    <el-form-item label="Score">
                      <el-input-number 
                        v-model="questionForm.score" 
                        :min="1" 
                        :max="100"
                        placeholder="Question score"
                      />
                    </el-form-item>
                  </el-col>
                </el-row>

                <el-form-item label="Question Tag">
                  <el-cascader
                    v-model="questionForm.tagPath"
                    :options="satTagOptions"
                    :props="tagCascaderProps"
                    clearable
                    filterable
                    placeholder="Select SAT/PSAT skill tag"
                    class="tag-cascader"
                    @change="onQuestionTagChange"
                    @clear="clearLegacyQuestionTag"
                  />
                  <div v-if="legacyQuestionTag" class="legacy-tag-note">
                    Legacy tag: {{ legacyQuestionTag }}
                    <el-button type="primary" link @click="clearLegacyQuestionTag">Clear</el-button>
                  </div>
                </el-form-item>

                <!-- 选择题选项 -->
                <el-form-item v-if="questionForm.type === 'multiple_choice'" label="Options">
                  <div class="options-editor">
                    <div v-for="(option, index) in questionForm.options" :key="index" class="option-item">
                      <div class="option-header">
                        <el-radio 
                          v-model="questionForm.correctAnswer" 
                          :label="String.fromCharCode(65 + index)"
                          class="option-radio"
                        >
                          {{ String.fromCharCode(65 + index) }}
                        </el-radio>
                        <span class="option-label">Option {{ String.fromCharCode(65 + index) }}</span>
                      </div>
                      <div class="option-content">
                        <el-input 
                          v-model="option.text" 
                          type="textarea"
                          :rows="2"
                          :placeholder="`Enter option ${String.fromCharCode(65 + index)} content (Markdown supported)...`"
                          class="option-textarea"
                          @paste="onOptionPaste($event, index)"
                        />
                        <div class="option-image-actions">
                          <el-upload
                            :auto-upload="false"
                            :show-file-list="false"
                            :disabled="optionImageUploading"
                            accept="image/*"
                            :on-change="file => onOptionImageChange(file, index)"
                          >
                            <el-button size="small" :loading="optionImageUploading && uploadingOptionIndex === index" :disabled="optionImageUploading">
                              Upload Image
                            </el-button>
                          </el-upload>
                          <span class="hint">You can also paste an image. Images are inserted into this option.</span>
                        </div>
                        <div v-if="option.text" class="option-preview">
                          <div class="preview-label">Preview:</div>
                          <div class="preview-content" v-math v-html="renderMarkdown(option.text)"></div>
                        </div>
                      </div>
                    </div>
                    <!-- 添加选项按钮 -->
                    <div v-if="showAddOptionButton" class="add-option-btn" @click="addNewOption">
                      <el-icon><Plus /></el-icon>
                      Add Option
                    </div>
                  </div>
                </el-form-item>

                <!-- 填空题答案 -->
                <el-form-item v-if="questionForm.type === 'fill_blank'" label="Correct Answer">
                  <div class="fill-blank-answers">
                    <div
                      v-for="index in questionForm.correctAnswers.length"
                      :key="index"
                      class="fill-blank-answer"
                    >
                      <el-input
                        v-model="questionForm.correctAnswers[index - 1]"
                        :placeholder="index === 1 ? 'Enter correct answer...' : 'Enter another accepted answer...'"
                      />
                      <el-button
                        v-if="questionForm.correctAnswers.length > 1"
                        type="danger"
                        link
                        @click="removeCorrectAnswer(index - 1)"
                      >
                        Remove
                      </el-button>
                    </div>
                    <el-button class="add-answer-btn" type="primary" link @click="addCorrectAnswer">
                      <el-icon><Plus /></el-icon>
                      Add Answer
                    </el-button>
                  </div>
                </el-form-item>

                <!-- 题目解释 -->
                <el-form-item label="Explanation">
                  <el-input 
                    v-model="questionForm.explanation" 
                    type="textarea" 
                    :rows="3"
                    placeholder="Enter explanation for the answer..."
                  />
                </el-form-item>
              </el-form>
            </div>
          </div>
        </div>
      </div>
    </div>

</template>

<script setup>
import { ref, reactive, computed, onMounted, nextTick, h } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessageBox } from 'element-plus'
import {
  ElButton, ElCascader, ElCol, ElEmpty, ElForm, ElFormItem, ElIcon, ElImage, ElInput, ElLoading,
  ElInputNumber, ElOption, ElRadio, ElRow, ElSelect, ElSwitch, ElUpload,
} from 'element-plus'
import { ArrowDown, Plus } from '@element-plus/icons-vue'
import draggable from 'vuedraggable'
import 'element-plus/dist/index.css'
import { RouterLink } from 'vue-router'
import { readEditorSelection, writeEditorSelection } from '@/utils/editorSelectionStorage'
import { notifyOperation } from '@/utils/operationNotification'
import { renderMarkdown } from './markdown.js'
import { paperEditApi } from './satEditorApi.js'

const operationToast = {
  success: (message) => notifyOperation(message, 'success'),
  error: (message) => notifyOperation(message, 'error'),
  warning: (message) => notifyOperation(message, 'warning'),
  info: (message) => notifyOperation(message, 'info'),
}

const route = useRoute()
const router = useRouter()
const vLoading = ElLoading.directive
const returnLocation = computed(() => {
  const returnTo = route.query.returnTo
  if (typeof returnTo === 'string'
    && (/^\/(sat|psat)(?:[/?#]|$)/.test(returnTo) || returnTo.startsWith('/exam-types/SAT/admin') || returnTo.startsWith('/exam-types/PSAT/admin'))
    && !returnTo.startsWith('//')) {
    return returnTo
  }
  return { name: route.name === 'psat-paper-edit' ? 'psat-admin' : 'sat-admin', query: { tab: 'papers' } }
})

function returnToPaperList() {
  router.push(returnLocation.value)
}

const satTagOptions = [
  {
    label: 'English Language Arts',
    value: 'English Language Arts',
    children: [
      {
        label: 'Standard English Conventions',
        value: 'Standard English Conventions',
        children: [
          {
            label: 'Standard',
            value: 'Standard',
            children: [
              { label: 'Boundaries', value: 'Boundaries' },
              { label: 'Form, Structure, and Sense', value: 'Form, Structure, and Sense' }
            ]
          }
        ]
      },
      {
        label: 'Expression of Ideas',
        value: 'Expression of Ideas',
        children: [
          {
            label: 'Expression',
            value: 'Expression',
            children: [
              { label: 'Transitions', value: 'Transitions' },
              { label: 'Rhetorical Synthesis', value: 'Rhetorical Synthesis' }
            ]
          }
        ]
      },
      {
        label: 'Craft and Structure',
        value: 'Craft and Structure',
        children: [
          {
            label: 'Structure',
            value: 'Structure',
            children: [
              { label: 'Words in Context', value: 'Words in Context' },
              { label: 'Text Structure and Purpose', value: 'Text Structure and Purpose' },
              { label: 'Cross-Text Connections', value: 'Cross-Text Connections' }
            ]
          }
        ]
      },
      {
        label: 'Information and Ideas',
        value: 'Information and Ideas',
        children: [
          {
            label: 'Information',
            value: 'Information',
            children: [
              { label: 'Central Ideas and Details', value: 'Central Ideas and Details' },
              { label: 'Command of Evidence', value: 'Command of Evidence' },
              { label: 'Inferences', value: 'Inferences' }
            ]
          }
        ]
      }
    ]
  },
  {
    label: 'Mathematics',
    value: 'Mathematics',
    children: [
      {
        label: 'Algebra',
        value: 'Algebra',
        children: [
          {
            label: 'Algebra',
            value: 'Algebra',
            children: [
              { label: 'Linear Equations', value: 'Linear Equations' },
              { label: 'Linear Functions', value: 'Linear Functions' },
              { label: 'Linear Inequalities', value: 'Linear Inequalities' },
              { label: 'System of Equations', value: 'System of Equations' }
            ]
          }
        ]
      },
      {
        label: 'Advanced Math',
        value: 'Advanced Math',
        children: [
          {
            label: 'Advanced',
            value: 'Advanced',
            children: [
              { label: 'Nonlinear Functions', value: 'Nonlinear Functions' },
              { label: 'Nonlinear Equations', value: 'Nonlinear Equations' },
              { label: 'Rational and Radical Exponents', value: 'Rational and Radical Exponents' }
            ]
          }
        ]
      },
      {
        label: 'Problem Solving and Data',
        value: 'Problem Solving and Data',
        children: [
          {
            label: 'Data',
            value: 'Data',
            children: [
              { label: 'Ratios and Proportions', value: 'Ratios and Proportions' },
              { label: 'Data Analysis', value: 'Data Analysis' },
              { label: 'Probability', value: 'Probability' }
            ]
          }
        ]
      },
      {
        label: 'Geometry and Trigonometry',
        value: 'Geometry and Trigonometry',
        children: [
          {
            label: 'Geometry',
            value: 'Geometry',
            children: [
              { label: 'Area and Volume', value: 'Area and Volume' },
              { label: 'Lines, Angles, and Triangles', value: 'Lines, Angles, and Triangles' },
              { label: 'Right Triangles and Trigonometry', value: 'Right Triangles and Trigonometry' }
            ]
          }
        ]
      }
    ]
  }
]

const tagCascaderProps = {
  emitPath: true,
  checkStrictly: false,
  expandTrigger: 'hover'
}

const normalizeTagValue = (value) => String(value || '').trim()
const tagPathToValue = (path) => (Array.isArray(path) && path.length > 0)
  ? path.map(normalizeTagValue).filter(Boolean).join(' > ')
  : ''

const findTagPath = (value, options = satTagOptions, ancestors = []) => {
  const normalized = normalizeTagValue(value)
  if (!normalized) return []

  for (const option of options) {
    const path = [...ancestors, option.value]
    const pathValue = tagPathToValue(path)
    if (pathValue === normalized) return path

    if (option.children) {
      const childPath = findTagPath(normalized, option.children, path)
      if (childPath.length > 0) return childPath
    }
  }
  return []
}

const toQuestionTagState = (tags) => {
  const normalized = normalizeTagValue(tags)
  if (!normalized) {
    return { tagPath: [], legacyTag: '' }
  }

  const tagPath = findTagPath(normalized)
  return tagPath.length > 0
    ? { tagPath, legacyTag: '' }
    : { tagPath: [], legacyTag: normalized }
}

// 页面数据
const paperTitle = ref('SAT Practice Test 1')
const selectedModule = ref(null)
const selectedQuestion = ref(null)
const expandedSections = ref([])
const expandedModules = ref([])
const showMaterialPreview = ref(false)
const showQuestionPreview = ref(false)
const loading = ref(false)
const stemImageUploading = ref(false)
const materialImageUploading = ref(false)
const questionContentInput = ref(null)
const materialContentInput = ref(null)
const questionCursor = reactive({ start: null, end: null })
const materialCursor = reactive({ start: null, end: null })
const optionImageUploading = ref(false)
const uploadingOptionIndex = ref(-1)

// 题型切换相关状态
const showAddOptionButton = ref(false) // 是否显示添加选项按钮

// 拖拽排序相关状态
const sortMode = ref(false) // 是否开启排序模式
const dragOptions = computed(() => ({
  animation: 200,
  group: 'questions',
  disabled: !sortMode.value, // 只有在排序模式下才能拖拽
  ghostClass: 'ghost'
}))

// 从路由获取试卷ID
const paperId = route.params.paperId

// 表单数据
const questionForm = reactive({
  id: null,
  type: 'multiple_choice',
  materialId: null,
  material: '',
  content: '',
  options: [
    { text: '' },
    { text: '' },
    { text: '' },
    { text: '' }
  ],
  correctAnswer: '',
  correctAnswers: [''],
  explanation: '',
  difficulty: 'medium',
  score: 1,
  tagPath: [],
  legacyTag: ''
})

// 备份原始选项数据，用于题型切换时恢复
const originalOptions = ref(null)
const savedQuestionDrafts = ref({})
const legacyQuestionTag = computed(() => questionForm.legacyTag)

const onQuestionTagChange = (path) => {
  if (Array.isArray(path) && path.length > 0) {
    questionForm.legacyTag = ''
  }
}

const clearLegacyQuestionTag = () => {
  questionForm.legacyTag = ''
}

// 计算属性 - Markdown渲染
const materialHtml = computed(() => renderMarkdown(questionForm.material))
const materialImageUrl = ref('')

const apiBase = import.meta.env.VITE_API_BASE_URL || ''

const normalizeUrl = (url) => {
  if (!url) return ''
  const value = String(url)
  if (value.startsWith('/uploads/')) return `${apiBase}${value}`
  if (value.startsWith('uploads/')) return `${apiBase}/${value}`
  return value
}

const resolveUploadUrl = (response) => {
  if (response?.success === false) return ''
  const value = response?.data ?? response
  if (typeof value === 'string') return normalizeUrl(value)
  if (value && typeof value === 'object') {
    return normalizeUrl(value.url || value.fileUrl || value.path || value.data || '')
  }
  return ''
}

const onDeleteMaterialImage = () => {
  materialImageUrl.value = ''
  operationToast.success('Image removed')
}
const questionHtml = computed(() => renderMarkdown(questionForm.content))

const isImageFile = (file) => {
  if (!file) return false
  return file.type?.startsWith('image/')
    || /\.(png|jpe?g|gif|webp)$/i.test(file.name || '')
}

const getClipboardImageFile = (event) => {
  const items = Array.from(event.clipboardData?.items || [])
  const imageItem = items.find(item => item.type?.startsWith('image/'))
  return imageItem?.getAsFile?.() || null
}

const getEditorTextarea = (inputRef) => {
  const input = inputRef.value
  return input?.textarea || input?.$el?.querySelector?.('textarea') || null
}

const getQuestionTextarea = () => getEditorTextarea(questionContentInput)
const getMaterialTextarea = () => getEditorTextarea(materialContentInput)
const isApiSuccess = (response) => response?.success === true || response?.code === 200
const getApiMessage = (error, fallback = 'Request failed') => {
  const message = error?.message || error?.response?.data?.message || error?.data?.message
  return message || fallback
}

const saveEditorCursor = (cursor, getTextarea, event) => {
  const textarea = event?.target?.tagName === 'TEXTAREA'
    ? event.target
    : getTextarea()
  if (!textarea) return
  cursor.start = textarea.selectionStart
  cursor.end = textarea.selectionEnd
}

const saveQuestionCursor = (event) => saveEditorCursor(questionCursor, getQuestionTextarea, event)
const saveMaterialCursor = (event) => saveEditorCursor(materialCursor, getMaterialTextarea, event)

const insertEditorImageMarkdown = async ({ url, textarea, cursor, getTextarea, text, updateText, altText }) => {
  const imageMarkdown = `![${altText}](${url})`
  const target = textarea || getTextarea()
  const start = typeof target?.selectionStart === 'number' ? target.selectionStart : cursor.start
  const end = typeof target?.selectionEnd === 'number' ? target.selectionEnd : cursor.end

  if (typeof start !== 'number' || typeof end !== 'number' || start < 0 || end < start) {
    const prefix = text && !text.endsWith('\n') ? '\n\n' : ''
    const nextText = `${text}${prefix}${imageMarkdown}`
    updateText(nextText)
    cursor.start = nextText.length
    cursor.end = nextText.length
  } else {
    const before = text.slice(0, start)
    const after = text.slice(end)
    const leading = before && !before.endsWith('\n') ? '\n' : ''
    const trailing = after && !after.startsWith('\n') ? '\n' : ''
    const inserted = `${leading}${imageMarkdown}${trailing}`
    const nextCursor = before.length + leading.length + imageMarkdown.length
    updateText(`${before}${inserted}${after}`)
    cursor.start = nextCursor
    cursor.end = nextCursor
  }

  await nextTick()
  const current = getTextarea()
  if (current && typeof cursor.start === 'number') {
    current.focus()
    current.setSelectionRange(cursor.start, cursor.end)
  }
}

const insertStemImageMarkdown = async (url, textarea) => {
  await insertEditorImageMarkdown({
    url,
    textarea,
    cursor: questionCursor,
    getTextarea: getQuestionTextarea,
    text: questionForm.content || '',
    updateText: value => { questionForm.content = value },
    altText: 'Question image'
  })
}

const insertMaterialImageMarkdown = async (url, textarea) => {
  await insertEditorImageMarkdown({
    url,
    textarea,
    cursor: materialCursor,
    getTextarea: getMaterialTextarea,
    text: questionForm.material || '',
    updateText: value => { questionForm.material = value },
    altText: 'Material image'
  })
}

const uploadEditorImage = async ({ file, textarea, uploadingRef, insertImage, label }) => {
  const raw = file?.raw || file
  if (!raw) return
  if (uploadingRef.value) {
    operationToast.warning('Image upload is already in progress')
    return
  }
  if (!isImageFile(raw)) {
    operationToast.error('Please upload an image file')
    return
  }
  uploadingRef.value = true
  try {
    const res = await paperEditApi.uploadMaterialImage(raw)
    const url = resolveUploadUrl(res)
    if (!url) {
      operationToast.error('Image upload failed')
      return
    }
    await insertImage(url, textarea)
    operationToast.success('Image uploaded')
  } catch (error) {
    console.error(`Failed to upload ${label} image:`, error)
    operationToast.error('Image upload failed')
  } finally {
    uploadingRef.value = false
  }
}

const uploadStemImage = async (file, textarea) => {
  await uploadEditorImage({
    file,
    textarea,
    uploadingRef: stemImageUploading,
    insertImage: insertStemImageMarkdown,
    label: 'stem'
  })
}

const uploadMaterialImage = async (file, textarea) => {
  await uploadEditorImage({
    file,
    textarea,
    uploadingRef: materialImageUploading,
    insertImage: insertMaterialImageMarkdown,
    label: 'material'
  })
}

const onStemImageChange = async (file) => {
  await uploadStemImage(file)
}

const onMaterialImageChange = async (file) => {
  await uploadMaterialImage(file)
}

// 选项图片沿用材料上传接口，并以 Markdown 文本保存在原有 options 字段中。
const uploadOptionImage = async (file, index) => {
  const raw = file?.raw || file
  if (!raw) return
  if (optionImageUploading.value) {
    operationToast.warning('Image upload is already in progress')
    return
  }
  if (!isImageFile(raw)) {
    operationToast.error('Please upload an image file')
    return
  }

  const targetQuestion = selectedQuestion.value
  optionImageUploading.value = true
  uploadingOptionIndex.value = index
  try {
    const response = await paperEditApi.uploadMaterialImage(raw)
    const url = resolveUploadUrl(response)
    if (!url) {
      operationToast.error('Image upload failed')
      return
    }
    // 上传期间允许切题；只在仍处于原题时回填，避免图片误写到另一道题。
    if (selectedQuestion.value !== targetQuestion) {
      operationToast.warning('Question changed during upload. Please upload the image again.')
      return
    }
    const option = questionForm.options[index]
    if (!option) return
    const separator = option.text && !option.text.endsWith('\n') ? '\n\n' : ''
    option.text = `${option.text || ''}${separator}![Option ${String.fromCharCode(65 + index)} image](${url})`
    operationToast.success('Image uploaded')
  } catch (error) {
    console.error('Failed to upload option image:', error)
    operationToast.error('Image upload failed')
  } finally {
    optionImageUploading.value = false
    uploadingOptionIndex.value = -1
  }
}

const onOptionImageChange = (file, index) => uploadOptionImage(file, index)

const onOptionPaste = async (event, index) => {
  const file = getClipboardImageFile(event)
  if (!file) return
  event.preventDefault()
  await uploadOptionImage(file, index)
}

const onQuestionPaste = async (event) => {
  const file = getClipboardImageFile(event)
  if (!file) return
  event.preventDefault()
  saveQuestionCursor(event)
  await uploadStemImage(file, event.target)
}

const onMaterialPaste = async (event) => {
  const file = getClipboardImageFile(event)
  if (!file) return
  event.preventDefault()
  saveMaterialCursor(event)
  await uploadMaterialImage(file, event.target)
}

const parseCorrectAnswers = (correctAnswer) => {
  if (!correctAnswer) return ['']
  try {
    const parsed = JSON.parse(correctAnswer)
    if (Array.isArray(parsed)) {
      const answers = parsed.map(answer => String(answer ?? ''))
      return answers.length > 0 ? answers : ['']
    }
  } catch {
    // Legacy questions store a single answer as plain text.
  }
  return [String(correctAnswer)]
}

const addCorrectAnswer = () => {
  questionForm.correctAnswers.push('')
}

const removeCorrectAnswer = (index) => {
  if (questionForm.correctAnswers.length <= 1) return
  questionForm.correctAnswers.splice(index, 1)
}

// SAT阶段和模块数据结构（从API获取）
const satSections = ref([])

// 方法
// 加载试卷结构数据
const loadPaperStructure = async () => {
  try {
    loading.value = true
    
    // 验证试卷ID
    if (!paperId || isNaN(paperId)) {
      operationToast.error('Invalid paper ID')
      returnToPaperList()
      return
    }
    
    const response = await paperEditApi.getStructure(paperId)
    
    if (response.success) {
      const paperData = response.data
      paperTitle.value = paperData.paperTitle

      // 将后端阶段下的模块扁平化，并映射为前端模块结构
      const mappedModules = (paperData.stages || [])
        .flatMap(stage => (stage.modules || []).map((module, idx) => {
          // 后端暂未返回 sortOrder，这里按阶段与索引推导：
          // RW: idx 0 -> 1, idx 1 -> 2; Math: idx 0 -> 3, idx 1 -> 4
          const stageCode = (stage.stageCode || stage.stageName || '').toUpperCase()
          let derivedOrder
          if (module.sortOrder != null) {
            derivedOrder = Number(module.sortOrder)
          } else if (stageCode.startsWith('RW')) {
            derivedOrder = idx === 0 ? 1 : 2
          } else {
            // 非RW视为Math
            derivedOrder = idx === 0 ? 3 : 4
          }

          return ({
            id: module.moduleId,
            name: module.moduleName,
            code: module.moduleCode,
            type: module.moduleType,
            moduleType: module.moduleNumber,
            subject: stageCode.startsWith('RW') ? 'RW' : 'Math',
          sortOrder: derivedOrder,
            moduleDifficulty: module.moduleDifficulty || 'Mid',
            description: module.description,
            questionCount: module.questionCount,
            totalScore: module.totalScore,
            duration: module.duration,
            isAdaptive: false,
            questions: (() => {
              const raw = module.questions || []
              const valid = raw.filter(q => q && q.questionId)
              return valid.map(q => ({
                id: q.questionId,
                questionId: q.questionId,
                questionOrder: q.questionOrder,
                type: q.typeName || 'Multiple Choice',
                typeName: q.typeName,
                typeId: q.typeId,
                material: q.material,
                content: q.content || '',
                options: q.options,
                correctAnswer: q.correctAnswer || '',
                correctAnswers: parseCorrectAnswers(q.correctAnswer),
                analysis: q.analysis || '',
                difficulty: q.difficulty || 'Medium',
                score: q.score || 1,
                materialId: q.materialId,
                tags: q.tags || ''
              }))
            })(),
            adaptiveOptions: []
          })
        }))

      // 固定的一级菜单：RW1、RW2、Math1、Math2，按 paper_module.sort_order = 1/2/3/4 分组
      const groupDefs = [
        { id: 'RW1', name: 'RW1', sortOrder: 1 },
        { id: 'RW2', name: 'RW2', sortOrder: 2 },
        { id: 'Math1', name: 'Math1', sortOrder: 3 },
        { id: 'Math2', name: 'Math2', sortOrder: 4 }
      ]

      satSections.value = groupDefs.map(g => ({
        id: g.id,
        name: g.name,
        code: g.id,
        modules: mappedModules
          .filter(m => Number(m.sortOrder ?? 999) === g.sortOrder)
          // 同组内稳定排序（若存在多模块，保持原有相对顺序）
          .slice()
      }))

      // 默认展开第一个有模块的分组；若都为空则展开 RW1
      const firstNonEmpty = satSections.value.find(sec => (sec.modules && sec.modules.length > 0))
      expandedSections.value = [firstNonEmpty ? firstNonEmpty.id : 'RW1']
      savedQuestionDrafts.value = {}
      restoreSavedQuestionSelection()
    } else {
      operationToast.error(response.message || 'Failed to load paper structure')
      // Return to the paper list when the requested paper is missing.
      if (response.message?.includes('not found')) {
        setTimeout(() => {
          returnToPaperList()
        }, 2000)
      }
    }
  } catch (error) {
    console.error('Error loading paper structure:', error)
    let errorMessage = 'Failed to load paper structure'
    
    // 根据错误状态码提供更友好的错误信息
    if (error.status === 404) {
      errorMessage = 'Paper not found, redirecting to papers list'
      setTimeout(() => {
        returnToPaperList()
      }, 2000)
    } else if (error.status === 500) {
      errorMessage = 'Server internal error, please try again later'
    } else if (error.message) {
      errorMessage = error.message
    }
    
    operationToast.error(errorMessage)
  } finally {
    loading.value = false
  }
}

const syncSavedQuestionLocally = ({ questionId, materialId, optionsData, correctAnswer, tags }) => {
  if (!selectedModule.value || !questionId) return

  const questions = selectedModule.value.questions || []
  const targetQuestion = questions.find(q => String(q.questionId || q.id) === String(questionId))
  const baseQuestion = targetQuestion || {
    id: questionId,
    questionId,
    questionOrder: questions.length + 1
  }

  if (!targetQuestion) {
    questions.push(baseQuestion)
    selectedModule.value.questions = questions
    selectedModule.value.questionCount = questions.length
  }

  const material = (questionForm.material || materialImageUrl.value)
    ? {
        id: materialId || null,
        content: questionForm.material || '',
        fileUrl: materialImageUrl.value || ''
      }
    : null

  const savedQuestion = {
    ...baseQuestion,
    id: questionId,
    questionId,
    type: questionForm.type === 'fill_blank' ? 'Fill Blank' : 'Multiple Choice',
    typeName: questionForm.type === 'fill_blank' ? 'Fill Blank' : 'Multiple Choice',
    typeId: baseQuestion.typeId || 1,
    material,
    materialId: materialId || null,
    content: questionForm.content || '',
    options: optionsData,
    correctAnswer,
    correctAnswers: parseCorrectAnswers(correctAnswer),
    analysis: questionForm.explanation || '',
    difficulty: questionForm.difficulty || 'medium',
    score: questionForm.score || 1,
    tags: tags || ''
  }
  savedQuestionDrafts.value = {
    ...savedQuestionDrafts.value,
    [String(questionId)]: savedQuestion
  }
  selectedQuestion.value = savedQuestion
  originalOptions.value = JSON.parse(JSON.stringify(parseQuestionOptions(optionsData)))
}

const findQuestionInModule = (moduleId, questionId) => {
  const targetModuleId = String(moduleId || '')
  const targetQuestionId = String(questionId || '')
  if (!targetModuleId || !targetQuestionId) return null

  for (const section of satSections.value) {
    for (const module of section.modules || []) {
      if (String(module.id) === targetModuleId) {
        const question = (module.questions || []).find(q => String(q.questionId || q.id) === targetQuestionId)
        if (question) return { section, module, question }
      }

      for (const option of module.adaptiveOptions || []) {
        if (String(option.id) === targetModuleId) {
          const question = (option.questions || []).find(q => String(q.questionId || q.id) === targetQuestionId)
          if (question) return { section, module: option, question }
        }
      }
    }
  }

  return null
}

// 加载题目详情
const loadQuestionDetail = async (questionId) => {
  try {
    const response = await paperEditApi.getQuestionDetail(questionId)
    
    if (response.success) {
      const questionData = response.data
      
      // 解析选项数据
      const parsedOptions = parseQuestionOptions(questionData.options)
      
      // 根据options是否为空判断题目类型
      const hasOptions = parsedOptions.some(option => option.text && option.text.trim() !== '')
      const questionType = hasOptions ? 'multiple_choice' : 'fill_blank'
      const tagState = toQuestionTagState(questionData.tags)
      
      // 填充表单数据
      Object.assign(questionForm, {
        id: questionData.id,
        type: questionType,
        material: questionData.material?.content || '',
        content: questionData.content || '',
        options: parsedOptions,
        correctAnswer: questionData.correctAnswer || '',
        correctAnswers: parseCorrectAnswers(questionData.correctAnswer),
        explanation: questionData.analysis || '',
        difficulty: questionData.difficulty || 'medium',
        score: questionData.score || 1,
        tagPath: tagState.tagPath,
        legacyTag: tagState.legacyTag
      })
    } else {
      operationToast.error('Failed to load question detail')
    }
  } catch (error) {
    console.error('Error loading question detail:', error)
    operationToast.error('Failed to load question detail')
  }
}

const toggleSection = (sectionId) => {
  const index = expandedSections.value.indexOf(sectionId)
  if (index > -1) {
    expandedSections.value.splice(index, 1)
  } else {
    expandedSections.value.push(sectionId)
  }
}

const toggleModule = (moduleId) => {
  const index = expandedModules.value.indexOf(moduleId)
  if (index > -1) {
    expandedModules.value.splice(index, 1)
  } else {
    expandedModules.value.push(moduleId)
  }
}

const selectQuestion = async (question, module) => {
  const questionId = question?.questionId || question?.id
  writeEditorSelection('sat', paperId, questionId ? { questionId: String(questionId), moduleId: String(module?.id || '') } : null)
  const savedDraft = savedQuestionDrafts.value[String(questionId)] || null
  const editableQuestion = savedDraft ? { ...question, ...savedDraft } : { ...question }
  selectedQuestion.value = editableQuestion
  selectedModule.value = module

  // 直接使用已加载的完整题目数据，无需再次请求
  if (editableQuestion) {
    // 解析选项数据
    const parsedOptions = parseQuestionOptions(editableQuestion.options)
    
    // 根据options是否为空判断题目类型
    const hasOptions = parsedOptions.some(option => option.text && option.text.trim() !== '')
    const questionType = hasOptions ? 'multiple_choice' : 'fill_blank'
    const tagState = toQuestionTagState(editableQuestion.tags)
    
    // 备份原始选项数据（深拷贝）
    originalOptions.value = JSON.parse(JSON.stringify(parsedOptions))
    
    // 填充表单数据，使用正确的属性名
    Object.assign(questionForm, {
      id: editableQuestion.questionId || editableQuestion.id,
      type: questionType,
      materialId: editableQuestion.materialId || editableQuestion.material?.id || null,
      material: editableQuestion.material?.content || '',
      content: editableQuestion.content || '',
      options: parsedOptions,
      correctAnswer: editableQuestion.correctAnswer || '',
      correctAnswers: parseCorrectAnswers(editableQuestion.correctAnswer),
      explanation: editableQuestion.analysis || '',
      difficulty: editableQuestion.difficulty || 'medium',
      score: editableQuestion.score || 1,
      tagPath: tagState.tagPath,
      legacyTag: tagState.legacyTag
    })
    // 设置材料图片预览（如果有）
    materialImageUrl.value = normalizeUrl(editableQuestion.material?.fileUrl || '')
  }
}

function restoreSavedQuestionSelection() {
  const savedSelection = readEditorSelection('sat', paperId)
  if (!savedSelection?.questionId) return

  for (const section of satSections.value) {
    for (const module of section.modules || []) {
      const candidates = [module, ...(module.adaptiveOptions || [])]
      for (const candidate of candidates) {
        const question = (candidate.questions || []).find((item) => {
          return String(item.questionId || item.id) === String(savedSelection.questionId)
        })
        if (!question) continue

        expandedSections.value = [section.id]
        expandedModules.value = [candidate.id]
        selectQuestion(question, candidate)
        return
      }
    }
  }

  writeEditorSelection('sat', paperId, null)
}

// 解析题目选项JSON字符串
const parseQuestionOptions = (optionsJson) => {
  if (!optionsJson) {
    return [
      { text: '' },
      { text: '' },
      { text: '' },
      { text: '' }
    ]
  }

  // 如果已经是对象，直接使用
  if (typeof optionsJson === 'object' && optionsJson !== null && !Array.isArray(optionsJson)) {
    return [
      { text: optionsJson.A || '' },
      { text: optionsJson.B || '' },
      { text: optionsJson.C || '' },
      { text: optionsJson.D || '' }
    ]
  }

  // 如果是字符串，尝试解析JSON
  try {
    const options = JSON.parse(optionsJson)
    // 处理数组格式: ["A) text1", "B) text2", "C) text3", "D) text4"]
    if (Array.isArray(options)) {
      return options.map((option, index) => {
        // 提取选项文本，去掉前面的字母标识
        let text = option
        if (typeof option === 'string') {
          // 匹配 "A) text" 或 "A text" 格式，提取text部分
          const match = option.match(/^[A-D]\)\s*(.+)$/) || option.match(/^[A-D]\s+(.+)$/)
          if (match) {
            text = match[1]
          }
        }
        return { text: text || '' }
      })
    }
    
    // 处理对象格式: {"A":"value1","B":"value2","C":"value3","D":"value4"}
    return [
      { text: options.A || '' },
      { text: options.B || '' },
      { text: options.C || '' },
      { text: options.D || '' }
    ]
  } catch (error) {
    console.error('Failed to parse question options:', optionsJson, error)
    return [
      { text: '' },
      { text: '' },
      { text: '' },
      { text: '' }
    ]
  }
}

const getQuestionNumber = (question) => {
  if (!question || !selectedModule.value) return ''

  const questions = selectedModule.value.questions || []
  const index = questions.findIndex(q => q.questionId === question.questionId)
  return index >= 0 ? index + 1 : ''
}

const addModule = async () => {
  try {
    const existsModule = (subject, order) => {
      const targetSort = subject === 'RW' ? order : order + 2
      return satSections.value.some(section =>
        Array.isArray(section.modules) &&
        section.modules.some(m => (m.sortOrder || 0) === targetSort)
      )
    }

    // Create a custom dialog for module creation
    let moduleDraft = null
    await ElMessageBox({
      title: 'Add New Module',
      message: h('div', { style: 'padding: 20px 0;' }, [
        h('div', { style: 'margin-bottom: 15px;' }, [
          h('label', { style: 'display: block; margin-bottom: 5px; font-weight: 500;' }, 'Module Type:'),
          h('select', {
            id: 'moduleSubject',
            style: 'width: 100%; padding: 8px; border: 1px solid #dcdfe6; border-radius: 4px;'
          }, [
            h('option', { value: 'RW' }, 'Reading and Writing'),
            h('option', { value: 'Math' }, 'Math')
          ])
        ]),
        h('div', { style: 'margin-bottom: 15px;' }, [
          h('label', { style: 'display: block; margin-bottom: 5px; font-weight: 500;' }, 'Module Order:'),
          h('select', {
            id: 'moduleOrder',
            style: 'width: 100%; padding: 8px; border: 1px solid #dcdfe6; border-radius: 4px;'
          }, [
            h('option', { value: '1' }, 'First Module'),
            h('option', { value: '2' }, 'Second Module')
          ])
        ]),
        h('div', { style: 'margin-bottom: 15px;' }, [
          h('label', { style: 'display: block; margin-bottom: 5px; font-weight: 500;' }, 'Module Name:'),
          h('input', {
            id: 'moduleName',
            type: 'text',
            placeholder: 'e.g., Reading and Writing Module 1',
            style: 'width: 100%; padding: 8px; border: 1px solid #dcdfe6; border-radius: 4px;'
          })
        ]),
        h('div', [
          h('label', { style: 'display: block; margin-bottom: 5px; font-weight: 500;' }, 'Description (Optional):'),
          h('textarea', {
            id: 'moduleDescription',
            placeholder: 'Enter module description...',
            style: 'width: 100%; padding: 8px; border: 1px solid #dcdfe6; border-radius: 4px; min-height: 60px; resize: vertical;'
          })
        ])
      ]),
      showCancelButton: true,
      confirmButtonText: 'Create Module',
      cancelButtonText: 'Cancel',
      beforeClose: (action, instance, done) => {
        if (action === 'confirm') {
          const subject = document.getElementById('moduleSubject').value
          const order = document.getElementById('moduleOrder').value
          const name = document.getElementById('moduleName').value.trim()
          const description = document.getElementById('moduleDescription').value.trim()
          
          if (!name) {
            operationToast.error('Module name is required')
            return
          }

          const numericOrder = parseInt(order)
          if (existsModule(subject, numericOrder)) {
            const label =
              subject === 'RW'
                ? (numericOrder === 1 ? 'Reading & Writing Module 1' : 'Reading & Writing Module 2')
                : (numericOrder === 1 ? 'Math Module 1' : 'Math Module 2')
            operationToast.error(`Module ${label} already exists. Each of RW1, RW2, Math1, Math2 can only have one module.`)
            return
          }
          
          instance.confirmButtonLoading = true
          instance.confirmButtonText = 'Creating...'
          
          // Capture the form data and close
          moduleDraft = {
            subject,
            order: numericOrder,
            name,
            description: description || `${name} - Auto-created module`
          }
          done()
        } else {
          done()
        }
      }
    })

    if (!moduleDraft) return

    // Calculate sort_order based on subject and order
    // RW: Module 1 = sort_order 1, Module 2 = sort_order 2
    // Math: Module 1 = sort_order 3, Module 2 = sort_order 4
    let sortOrder
    if (moduleDraft.subject === 'RW') {
      sortOrder = moduleDraft.order // 1 or 2
    } else { // Math
      sortOrder = moduleDraft.order + 2 // 3 or 4
    }

    // Prepare module data
    const moduleData = {
      paperId: parseInt(route.params.paperId),
      moduleName: moduleDraft.name,
      description: moduleDraft.description,
      subject: moduleDraft.subject,
      moduleType: moduleDraft.order, // 1 for first module, 2 for second module
      moduleDifficulty: 'Mid', // Default difficulty
      timeLimit: 32, // 32 minutes
      questionCount: 0, // Initial question count
      sortOrder: sortOrder
    }

    // Call API to create module
    const response = await paperEditApi.createModule(moduleData)
    
    if (response.success) {
      operationToast.success('Module created successfully')
      // Reload paper structure
      await loadPaperStructure()
    } else {
      operationToast.error('Failed to create module: ' + (response.message || 'Unknown error'))
    }
  } catch (error) {
    if (error !== 'cancel') {
      console.error('Failed to create module:', error)
      operationToast.error('Failed to create module')
    }
  }
}

const addQuestion = async (module) => {
  try {
    if (!module || !module.id) {
      operationToast.error('Please select a valid module first')
      return
    }

    // 准备新题目的默认数据
    const newQuestionData = {
      subject: module.subject,
      moduleId: module.id,
      typeId: 1, // 默认选择题类型ID
      content: 'Please enter question content...',
      options: {
        A: 'Option A',
        B: 'Option B', 
        C: 'Option C',
        D: 'Option D'
      },
      correctAnswer: 'A',
      analysis: '',
      difficulty: 'Medium',
      score: 1,
      materialId: null,
      tags: null
    }

    // 调用API创建题目
    const response = await paperEditApi.createQuestion(newQuestionData)
    
    if (isApiSuccess(response)) {
      operationToast.success('Question created successfully')
      // 重新加载试卷结构
      await loadPaperStructure()
      
      // 自动选择新创建的题目进行编辑
      const createdQuestionId = response.data?.id || response.data
      if (createdQuestionId) {
        const location = findQuestionInModule(module.id, createdQuestionId)
        if (location) {
          if (!expandedSections.value.includes(location.section.id)) {
            expandedSections.value.push(location.section.id)
          }
          if (!expandedModules.value.includes(location.module.id)) {
            expandedModules.value.push(location.module.id)
          }
          await selectQuestion(location.question, location.module)
        }
      }
    } else {
      operationToast.error('Question creation failed: ' + getApiMessage(response, 'Unknown error'))
    }
  } catch (error) {
    console.error('Failed to create question:', {
      message: error?.message,
      code: error?.code,
      status: error?.status,
      response: error?.response,
      error
    })
    operationToast.error(`Failed to create question. ${getApiMessage(error, '')}`.trim())
  }
}

const saveQuestion = async () => {
  try {
    if (stemImageUploading.value || materialImageUploading.value || optionImageUploading.value) {
      operationToast.warning('Please wait for the image upload to finish')
      return
    }
    // 验证必填字段，保存时仍保留原始空格和换行。
    if (!questionForm.content || !questionForm.content.trim()) {
      operationToast.error('Question content cannot be empty')
      return
    }
    const validCorrectAnswers = questionForm.type === 'fill_blank'
      ? questionForm.correctAnswers.filter(answer => answer && answer.trim())
      : [questionForm.correctAnswer].filter(Boolean)
    if (validCorrectAnswers.length === 0) {
      operationToast.error('Correct answer cannot be empty')
      return
    }
    if (!selectedModule.value) {
      operationToast.error('Please select a module first')
      return
    }
    const currentQuestionId = questionForm.id || selectedQuestion.value?.questionId || selectedQuestion.value?.id

    // 验证选择题必须有选项
    if (questionForm.type === 'multiple_choice') {
      const hasValidOptions = questionForm.options.some(option => option.text && option.text.trim() !== '')
      if (!hasValidOptions) {
        operationToast.error('Please add at least one option for multiple choice questions')
        return
      }
    }

    // 根据题型处理选项数据
    let optionsData = null
    if (questionForm.type === 'multiple_choice') {
      const hasValidOptions = questionForm.options.some(option => option.text && option.text.trim() !== '')
      if (hasValidOptions) {
        optionsData = {
          A: questionForm.options[0]?.text || '',
          B: questionForm.options[1]?.text || '',
          C: questionForm.options[2]?.text || '',
          D: questionForm.options[3]?.text || ''
        }
      }
    }

    const prevMaterialId = questionForm.materialId || null
    let materialId = prevMaterialId
    let materialToDelete = null
    const hasText = !!(questionForm.material && questionForm.material.trim())
    const hasImage = !!materialImageUrl.value
    if (hasText || hasImage) {
      try {
        const materialType = hasText && hasImage ? 'mixed' : (hasImage ? 'image' : 'text')
        const materialPayload = {
          title: `Question Material ${Date.now()}`,
          materialType,
          content: hasText ? questionForm.material : '',
          fileUrl: hasImage ? materialImageUrl.value : '',
          source: null
        }
        if (materialId) {
          const resp = await paperEditApi.updateMaterial(materialId, materialPayload)
          if (!isApiSuccess(resp)) {
            console.warn('Material update failed, creating a replacement material:', {
              materialId,
              code: resp?.code,
              message: resp?.message
            })
            const materialResponse = await paperEditApi.createMaterial(materialPayload)
            if (isApiSuccess(materialResponse)) {
              materialId = materialResponse.data
            } else {
              throw new Error(materialResponse?.message || 'Failed to create replacement material')
            }
          }
        } else {
          const materialResponse = await paperEditApi.createMaterial(materialPayload)
          if (isApiSuccess(materialResponse)) {
            materialId = materialResponse.data
          } else {
            throw new Error(materialResponse?.message || 'Failed to create material')
          }
        }
      } catch (error) {
        console.error('Error saving material:', {
          message: error?.message,
          code: error?.code,
          status: error?.status,
          response: error?.response,
          error
        })
        operationToast.warning(`Material could not be saved. The question will still be saved. ${getApiMessage(error, '')}`.trim())
      }
    } else {
      if (prevMaterialId) {
        materialToDelete = prevMaterialId
      }
      materialId = null
      questionForm.materialId = null
      questionForm.material = ''
      materialImageUrl.value = ''
    }

    // 题目数据准备
    // Keep the legacy plain-text format for one answer and use JSON for alternatives.
    const correctAnswer = questionForm.type === 'fill_blank'
      ? (validCorrectAnswers.length === 1 ? validCorrectAnswers[0] : JSON.stringify(validCorrectAnswers))
      : questionForm.correctAnswer
    const selectedTag = tagPathToValue(questionForm.tagPath)
    const tags = selectedTag || normalizeTagValue(questionForm.legacyTag) || ''
    const questionData = {
      id: questionForm.id,
      subject: selectedModule.value.subject,
      moduleId: selectedModule.value?.id,
      typeId: 1, // 使用默认题型ID，后端会根据options自动判断
      content: questionForm.content,
      options: optionsData,
      correctAnswer,
      analysis: questionForm.explanation,
      difficulty: questionForm.difficulty || 'Medium',
      score: questionForm.score || 1,
      materialId: materialId,
      tags
    }

    let response
    if (questionForm.id) {
      // 更新题目
      response = await paperEditApi.updateQuestion(questionData)
    } else {
      // 创建新题目
      response = await paperEditApi.createQuestion(questionData)
    }

    if (isApiSuccess(response)) {
      operationToast.success(questionForm.id ? 'Question updated successfully' : 'Question created successfully')
      const savedQuestionId = currentQuestionId || response.data?.id || response.data
      // 成功后，根据最终materialId更新本地引用
      questionForm.materialId = materialId || null
      // 若需要删除旧材料，在题目成功保存且不再引用后再删除
      if (materialToDelete) {
        try {
          await paperEditApi.deleteMaterial(materialToDelete)
        } catch (error) {
          console.error('Error deleting material:', error)
          operationToast.warning('Material record could not be deleted. Please clean it up later.')
        }
      }
      questionForm.id = savedQuestionId
      syncSavedQuestionLocally({
        questionId: savedQuestionId,
        materialId,
        optionsData,
        correctAnswer,
        tags
      })
    } else {
      operationToast.error(`Failed to save question. ${getApiMessage(response, '')}`.trim())
    }
  } catch (error) {
    console.error('Error saving question:', {
      message: error?.message,
      code: error?.code,
      status: error?.status,
      response: error?.response,
      error
    })
    operationToast.error(`Failed to save question. ${getApiMessage(error, '')}`.trim())
  }
}

const deleteQuestion = async () => {
  if (!selectedQuestion.value?.questionId) {
    operationToast.warning('No question selected')
    return
  }
  const deletingQuestionId = selectedQuestion.value.questionId

  try {
    await ElMessageBox.confirm('Are you sure you want to delete this question?', 'Warning', {
      confirmButtonText: 'Delete',
      cancelButtonText: 'Cancel',
      type: 'warning'
    })

    const response = await paperEditApi.deleteQuestion(selectedQuestion.value.questionId)
    
    if (response.success) {
      operationToast.success('Question deleted successfully')
      // 清空选中状态
      selectedQuestion.value = null
      selectedModule.value = null
      writeEditorSelection('sat', paperId, null)
      // 重置编辑表单，避免残留的材料ID或内容影响后续新建
      Object.assign(questionForm, {
        id: null,
        type: 'multiple_choice',
        materialId: null,
        material: '',
        content: '',
        options: [
          { text: '' },
          { text: '' },
          { text: '' },
          { text: '' }
        ],
        correctAnswer: '',
        correctAnswers: [''],
        explanation: '',
        difficulty: 'medium',
        score: 1,
        tagPath: [],
        legacyTag: ''
      })
      materialImageUrl.value = ''
      // 重新加载试卷结构
      delete savedQuestionDrafts.value[String(deletingQuestionId)]
      await loadPaperStructure()
    } else {
      operationToast.error('Failed to delete question')
    }
  } catch (error) {
    if (error !== 'cancel') {
      console.error('Error deleting question:', error)
      operationToast.error('Failed to delete question')
    }
  }
}

// 题型切换处理方法
const onQuestionTypeChange = (newType) => {
  if (newType === 'fill_blank') {
    // 选择题改为填空题：清空选项
    questionForm.options = [
      { text: '' },
      { text: '' },
      { text: '' },
      { text: '' }
    ]
    questionForm.correctAnswers = parseCorrectAnswers(questionForm.correctAnswer)
    showAddOptionButton.value = false
  } else if (newType === 'multiple_choice') {
    // 填空题改为选择题：恢复原始选项数据
    // A fill-blank answer cannot be reused as a multiple-choice option.
    questionForm.correctAnswer = ''
    questionForm.correctAnswers = ['']
    if (originalOptions.value && originalOptions.value.length > 0) {
      // 检查原始选项是否有有效内容
      const hasValidOriginalOptions = originalOptions.value.some(option => option.text && option.text.trim() !== '')
      if (hasValidOriginalOptions) {
        // 恢复原始选项数据（深拷贝）
        questionForm.options = JSON.parse(JSON.stringify(originalOptions.value))
        showAddOptionButton.value = false
      } else {
        // 原始选项为空，显示添加选项按钮
        questionForm.options = [
          { text: '' },
          { text: '' },
          { text: '' },
          { text: '' }
        ]
        showAddOptionButton.value = true
      }
    } else {
      // 没有原始选项数据，显示添加选项按钮
      questionForm.options = [
        { text: '' },
        { text: '' },
        { text: '' },
        { text: '' }
      ]
      showAddOptionButton.value = true
    }
  }
}

// 添加新选项
const addNewOption = () => {
  // 确保至少有4个选项
  if (questionForm.options.length < 4) {
    questionForm.options.push({ text: '' })
  }
  showAddOptionButton.value = false
}

// 拖拽排序相关方法
const toggleSortMode = () => {
  sortMode.value = !sortMode.value
  if (sortMode.value) {
    operationToast.info('Drag questions to reorder them or move them between modules.')
  } else {
    operationToast.info('Sort mode disabled.')
  }
}

const onQuestionMove = async (evt, module) => {
  if (!sortMode.value) return

  // 不立即更新后端，只在用户点击保存时才更新
  operationToast.info('Question order changed. Click "Save Order" to apply changes.')
}

const saveSortOrder = async () => {
  if (!sortMode.value) return

  try {
    const modules = satSections.value.flatMap(section => section.modules).map(module => ({
      moduleId: module.id,
      questionIds: (module.questions || []).map(question => question.questionId || question.id),
    }))
    await paperEditApi.saveQuestionLayout(modules)
    
    operationToast.success('All question orders saved successfully')
    sortMode.value = false
    // 重新加载试卷结构以更新题目序号
    await loadPaperStructure()
  } catch (error) {
    console.error('保存题目顺序失败:', error)
    operationToast.error('Failed to save question order')
    await loadPaperStructure()
  }
}

// 移除格式标记，列表根据实际可用宽度省略过长的题目文字。
const getQuestionPreview = (content) => {
  if (!content) return ''
  return content.replace(/<[^>]*>/g, '').replace(/[#*_`]/g, '').replace(/\s+/g, ' ').trim()
}

// 只展示题目已有的类型和难度，列表与编辑区使用相同数据来源。
const questionListTags = (question) => [question.typeName || question.type, question.difficulty]
  .filter(value => typeof value === 'string' && value.trim())

// 初始化
onMounted(async () => {
  await loadPaperStructure()
})
</script>

<style scoped>
.sat-editor-back {
  display: inline-flex;
  align-items: center;
  margin: 16px 0 0;
  color: var(--color-primary-strong);
  font-weight: 700;
}

.main-content {
  width: 100%;
  max-width: 1760px;
  margin: 0 auto;
  padding: 24px clamp(12px, 1.5vw, 24px);
  font-family: inherit;
}

.main-content :deep(.el-button),
.main-content :deep(.el-switch__label) {
  font-family: inherit;
  font-size: 14px;
}

.main-content :deep(.el-input__inner),
.main-content :deep(.el-select__selected-item),
.main-content :deep(.el-form-item__label) {
  font-family: inherit;
  font-size: 16px;
}

.header-section {
  margin-bottom: 24px;
  text-align: center;
}



.page-title {
  font-size: 24px;
  font-weight: 600;
  color: #303133;
  margin: 0 0 8px 0;
}

.page-subtitle {
  font-size: 14px;
  color: #606266;
  margin: 0;
}

.paper-edit-container {
  display: flex;
  gap: 24px;
  height: calc(100vh - 200px);
  min-height: 600px;
}

.modules-panel {
  flex: 0 0 370px;
  min-width: 0;
  background: white;
  border-radius: 8px;
  border: 1px solid #e4e7ed;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.panel-header {
  padding: 16px;
  border-bottom: 1px solid #e4e7ed;
  background: #f8f9fa;
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-shrink: 0;
}

.panel-header h3 {
  margin: 0 0 8px 0;
  font-size: 18px;
  font-weight: 600;
  color: #303133;
}

.header-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.sections-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.section-group {
  margin-bottom: 8px;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px;
  background: #f8f9fa;
  border-radius: 6px;
  cursor: pointer;
  transition: background-color 0.2s;
}

.section-header:hover {
  background: #e9ecef;
}

.section-info h4 {
  margin: 0 0 4px 0;
  font-size: 17px;
  font-weight: 600;
  color: #303133;
}

.module-count {
  font-size: 14px;
  color: #909399;
  font-weight: 500;
}

.modules-list {
  padding-left: 16px;
  margin-top: 8px;
}

.module-section {
  margin-bottom: 6px;
}

.module-section.active {
  background: #f0f9ff;
  border-radius: 6px;
}

.module-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 12px;
  cursor: pointer;
  border-radius: 4px;
  transition: background-color 0.2s;
}

.module-header:hover {
  background: rgba(64, 158, 255, 0.1);
}

.module-info h5 {
  margin: 0 0 2px 0;
  font-size: 16px;
  font-weight: 600;
  color: #303133;
}

.question-count {
  font-size: 13px;
  color: #909399;
  font-weight: 500;
}

.expand-icon {
  transition: transform 0.3s;
  color: #909399;
}

.expand-icon.expanded {
  transform: rotate(180deg);
}

.adaptive-options {
  padding-left: 16px;
  margin-top: 4px;
}

.adaptive-option {
  margin-bottom: 4px;
  border-radius: 4px;
}

.adaptive-option.active {
  background: #f0f9ff;
}

.adaptive-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 10px;
  cursor: pointer;
  border-radius: 4px;
  transition: background-color 0.2s;
}

.adaptive-header:hover {
  background: rgba(64, 158, 255, 0.1);
}

.adaptive-info h6 {
  margin: 0 0 2px 0;
  font-size: 15px;
  font-weight: 600;
  color: #303133;
}

.adaptive-desc {
  font-size: 12px;
  color: #909399;
  display: block;
  margin-bottom: 2px;
}

.questions-list {
  padding: 0 8px 8px;
  margin-top: 4px;
}

.question-item {
  display: grid;
  grid-template-columns: 16px auto minmax(0, 1fr);
  align-items: center;
  gap: 5px 8px;
  min-width: 0;
  min-height: 58px;
  padding: 10px;
  border: 1px solid var(--color-border);
  cursor: pointer;
  border-radius: 10px;
  background: #fff;
  transition: border-color 140ms ease, background-color 140ms ease, box-shadow 140ms ease;
  margin-bottom: 8px;
}

.question-item:hover {
  border-color: var(--color-primary);
  background: #f7faff;
}

.question-item.active {
  border-color: var(--color-primary);
  background: #f7faff;
  box-shadow: inset 3px 0 0 var(--color-primary), 0 8px 18px rgba(47, 111, 237, 0.1);
}

.question-number {
  grid-column: 2;
  justify-self: start;
  padding: 2px 7px;
  border-radius: 999px;
  background: #eef5ff;
  color: #1f3f73;
  font-size: 15px;
  font-weight: 800;
  line-height: 1.35;
}

.question-list-preview {
  grid-column: 3;
  min-width: 0;
  color: #172033;
  font-size: 15px;
  font-weight: 650;
  line-height: 1.35;
  overflow: hidden;
  overflow-wrap: anywhere;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.question-meta {
  grid-column: 2 / -1;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.question-meta-tag {
  max-width: 100%;
  overflow: hidden;
  border: 1px solid #e0e7f3;
  border-radius: 999px;
  padding: 2px 6px;
  color: #64748b;
  background: #f8fafc;
  font-size: 13px;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 拖拽排序相关样式 */
.question-item.sortable {
  cursor: move;
  border-style: dashed;
}

.question-item.sortable:hover {
  border-color: #409eff;
  background: #f0f9ff;
}

.drag-handle {
  grid-column: 1;
  grid-row: 1 / 3;
  align-self: stretch;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #9aa7ba;
  font-size: 13px;
  letter-spacing: -3px;
  cursor: grab;
  user-select: none;
}

.drag-handle:active {
  cursor: grabbing;
}

.ghost {
  opacity: 0.5;
  background: #409eff !important;
  color: white !important;
}

.add-question-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 8px;
  color: #409eff;
  font-size: 13px;
  cursor: pointer;
  border-radius: 4px;
  transition: background-color 0.2s;
  margin-top: 4px;
}

.add-question-btn:hover {
  background: rgba(64, 158, 255, 0.1);
}

.add-option-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px 12px;
  color: #409eff;
  font-size: 14px;
  cursor: pointer;
  border-radius: 4px;
  border: 1px dashed #409eff;
  transition: all 0.2s;
  margin-top: 8px;
  justify-content: center;
}

.add-option-btn:hover {
  background: rgba(64, 158, 255, 0.1);
  border-color: #66b1ff;
}

.fill-blank-answers {
  width: 100%;
}

.fill-blank-answer {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.fill-blank-answer .el-input {
  flex: 1;
}

.add-answer-btn {
  padding-left: 0;
}

.question-panel {
  flex: 1;
  min-width: 0;
  background: white;
  border-radius: 8px;
  border: 1px solid #e4e7ed;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  max-height: calc(100vh - 200px);
}

.no-selection {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #909399;
}

.question-editor {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.editor-header {
  padding: 16px;
  border-bottom: 1px solid #e4e7ed;
  background: #f8f9fa;
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-shrink: 0;
}

.editor-header h3 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: #303133;
}

.editor-actions {
  display: flex;
  gap: 8px;
}

.editor-content {
  flex: 1;
  padding: 16px;
  overflow-y: auto;
  max-height: calc(100vh - 300px);
}

.material-section,
.question-section {
  margin-bottom: 24px;
}

.section-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.section-title h4 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: #303133;
}

.section-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.material-preview,
.question-preview {
  padding: 16px;
  min-height: 120px;
  background: white;
}

.material-tools { display:flex; align-items:center; gap:8px; margin-bottom:8px; }
.material-tools .hint { font-size: 14px; color: #909399; }
.markdown-hint {
  padding: 0 16px 8px;
  color: #909399;
  font-size: 14px;
}
.markdown-hint code {
  padding: 1px 4px;
  border-radius: 3px;
  background: #f2f3f5;
  color: #606266;
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
}
.image-preview :deep(img), .image-preview :deep(.el-image) { max-width: 100%; border: 1px solid #e4e7ed; border-radius: 4px; margin-top: 8px; }

.material-editor,
.question-editor {
  border: none !important;
  box-shadow: none !important;
}

.material-editor :deep(.el-textarea__inner) {
  border: none;
  box-shadow: none;
  padding: 16px;
  font-family: inherit;
  font-size: 17px;
  line-height: 1.5;
  min-height: 180px;
}

.question-editor :deep(.el-textarea__inner) {
  border: none;
  box-shadow: none;
  padding: 16px;
  font-family: inherit;
  font-size: 17px;
  line-height: 1.5;
}

.passage-content {
  font-size: 17px;
  line-height: 1.6;
  color: #333;
  text-align: left;
}

.passage-content :deep(h1),
.passage-content :deep(h2),
.passage-content :deep(h3),
.passage-content :deep(h4) {
  margin: 16px 0 8px 0;
  font-weight: 600;
}

.preview-content :deep(u) {
  text-decoration: underline;
  text-decoration-thickness: 1px;
  text-underline-offset: 2px;
}

.passage-content :deep(ul),
.passage-content :deep(ol) {
  margin: 8px 0;
  padding-left: 20px;
}

.passage-content :deep(li) {
  margin: 4px 0;
}

.passage-content :deep(img) {
  max-height: 420px;
}

.question-text {
  font-size: 17px;
  font-weight: 600;
  color: #333;
  line-height: 1.5;
  text-align: left;
  max-width: 100%;
}

/* 预览区域内元素的宽度与溢出控制 */
.question-text :deep(img),
.question-text :deep(table),
.question-text :deep(pre),
.question-text :deep(code) {
  max-width: 100%;
}

.question-text :deep(img) {
  max-height: 420px;
}

.question-text :deep(pre) {
  max-width: 100%;
}

.no-material {
  color: #909399;
  font-style: italic;
  text-align: center;
  padding: 40px 0;
}

.question-form {
  margin-top: 16px;
}

.question-form :deep(.el-form-item) {
  margin-bottom: 18px;
}

.question-form :deep(.el-form-item__label) {
  font-weight: 600;
  color: #303133;
}

.tag-cascader {
  width: 100%;
}

.legacy-tag-note {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
  color: #909399;
  font-size: 12px;
  line-height: 1.4;
}

.options-editor {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-height: 500px;
  overflow-y: auto;
  padding: 12px;
  border: 1px solid #e4e7ed;
  border-radius: 6px;
  background: #fafbfc;
  width: 100%;
  box-sizing: border-box;
}

/* 自定义滚动条样式 - 浅灰色 */
.options-editor::-webkit-scrollbar {
  width: 8px;
}

.options-editor::-webkit-scrollbar-track {
  background: #f1f1f1;
  border-radius: 4px;
}

.options-editor::-webkit-scrollbar-thumb {
  background: #c0c4cc;
  border-radius: 4px;
  transition: background-color 0.3s;
}

.options-editor::-webkit-scrollbar-thumb:hover {
  background: #a6a9ad;
}

.sections-list::-webkit-scrollbar {
  width: 8px;
}

.sections-list::-webkit-scrollbar-track {
  background: #f1f1f1;
  border-radius: 4px;
}

.sections-list::-webkit-scrollbar-thumb {
  background: #c0c4cc;
  border-radius: 4px;
  transition: background-color 0.3s;
}

.sections-list::-webkit-scrollbar-thumb:hover {
  background: #a6a9ad;
}

.editor-content::-webkit-scrollbar {
  width: 8px;
}

.editor-content::-webkit-scrollbar-track {
  background: #f1f1f1;
  border-radius: 4px;
}

.editor-content::-webkit-scrollbar-thumb {
  background: #c0c4cc;
  border-radius: 4px;
  transition: background-color 0.3s;
}

.editor-content::-webkit-scrollbar-thumb:hover {
  background: #a6a9ad;
}

.option-item {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  background: white;
  border-radius: 6px;
  border: 1px solid #e4e7ed;
  width: 100%;
  box-sizing: border-box;
}

.option-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.option-radio {
  flex-shrink: 0;
}

.option-label {
  font-weight: 600;
  color: #303133;
  font-size: 16px;
}

.option-content {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.option-image-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}

.option-image-actions .hint {
  color: #7a8497;
  font-size: 14px;
}

.option-textarea {
  width: 100%;
}

.option-textarea :deep(.el-textarea) {
  width: 100%;
}

.option-textarea :deep(.el-textarea__inner) {
  min-height: 80px;
  font-family: inherit;
  font-size: 17px;
  line-height: 1.5;
  resize: vertical;
  width: 100%;
  box-sizing: border-box;
}

.option-preview {
  border-top: 1px solid #e4e7ed;
  padding-top: 8px;
}

.option-preview :deep(img) {
  display: block;
  max-width: 100%;
  max-height: 240px;
  object-fit: contain;
  margin: 8px 0;
}

.preview-label {
  font-size: 14px;
  color: #909399;
  margin-bottom: 4px;
  font-weight: 500;
}

.preview-content {
  padding: 8px;
  background: #f8f9fa;
  border-radius: 4px;
  border: 1px solid #e9ecef;
  font-size: 17px;
  line-height: 1.5;
  color: #333;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.preview-content :deep(p) {
  margin: 0;
}

.preview-content :deep(p:last-child) {
  margin-bottom: 0;
}

.preview-content :deep(strong) {
  font-weight: 600;
}

.preview-content :deep(u) {
  text-decoration-thickness: 1px;
  text-underline-offset: 2px;
}

.preview-content :deep(em) {
  font-style: italic;
}

.preview-content :deep(code) {
  background: #e9ecef;
  padding: 2px 4px;
  border-radius: 3px;
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
  font-size: 12px;
}

/* 响应式设计 */
@media (max-width: 1400px) {
  .modules-panel {
    flex-basis: 340px;
  }
}

@media (max-width: 1200px) {
  .modules-panel {
    flex-basis: 310px;
  }
}

@media (max-width: 768px) {
  .paper-edit-container {
    flex-direction: column;
    height: auto;
  }

  .modules-panel {
    flex: none;
    width: 100%;
    height: 350px;
  }

  .question-panel {
    height: 600px;
  }

  .editor-content {
    padding: 12px;
  }
}
</style>
